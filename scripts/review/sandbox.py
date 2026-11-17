"""Managed owner-only sandbox broker. Agents never need to read credentials."""
import hashlib, json, os, pathlib, time, urllib.error, uuid, email.utils
from urllib.parse import quote
from evidence import game
from deploy import atomic

class SandboxError(RuntimeError): pass

def fingerprint(work):
    digest=hashlib.sha256()
    digest.update(b'norm-steward-source-fingerprint-v2\0')
    for folder in ['src/advisors','src/control','src/bot','src/review']:
        for path in sorted((pathlib.Path(work)/folder).rglob('*.ts')):
            digest.update(str(path.relative_to(work)).encode());digest.update(b'\0');digest.update(path.read_bytes())
    return digest.hexdigest()

class Broker:
    def __init__(self, directory, work, api=game):
        self.directory=pathlib.Path(directory);self.work=pathlib.Path(work);self.raw_api=api
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.path=self.directory/'sandboxes.json'
        self.registry=json.loads(self.path.read_text()) if self.path.exists() else {'worlds':{},'requests':{}}
    def api(self,*args,**kwargs):
        for attempt in range(6):
            try:return self.raw_api(*args,**kwargs)
            except urllib.error.HTTPError as error:
                if error.code!=429 or attempt==5:raise
                header=error.headers.get('Retry-After','1')
                try:delay=max(1,float(header))
                except ValueError:delay=max(1,email.utils.parsedate_to_datetime(header).timestamp()-time.time())
                self.record('rate-limit',ok=False,retryAfterSeconds=delay)
                if delay>60:raise SandboxError(f'Rate limited for {delay:.0f} seconds; preserve work and retry later')
                time.sleep(delay)
        raise SandboxError('Sandbox rate limit persisted')
    def save(self): atomic(self.path,self.registry)
    def record(self,op,world=None,**extra):
        with (self.directory/'sandbox-events.jsonl').open('a') as file:
            file.write(json.dumps({'at':time.time(),'op':op,'worldId':world,'fingerprint':fingerprint(self.work),**extra})+'\n');file.flush();os.fsync(file.fileno())
    def call(self,request):
        op=request.get('op');world=request.get('world')
        try:
            if op=='create':
                if len(self.registry['worlds'])>=8:raise SandboxError('Eight sandbox creations per review is the limit; finish this bounded experiment')
                me=self.api('/me')['account']['id']
                config={'name':'review-'+uuid.uuid4().hex[:8],'seed':int(request.get('seed',73421)),'durationTicks':int(request.get('durationTicks',600)),'clock':'lockstep','paused':True,'houseBots':request.get('houseBots',{'warden':0,'reaver':0,'sovereign':0})}
                if not 600<=config['durationTicks']<=10800:raise SandboxError('Use a bounded 600–10800 tick experiment')
                result=self.api('/sandboxes',config)
                if result.get('kind')!='sandbox' or result.get('ownerId')!=me:raise SandboxError('Server did not return an owner-created sandbox')
                world=result['id'];self.registry['worlds'][world]={'ownerId':me,'deleted':False,'config':config};self.save()
                self.record(op,world,ok=True,config=config);return result
            if op=='cleanup':
                results=[]
                for world,value in self.registry['worlds'].items():
                    if not value['deleted']:results.append(self.call({'op':'delete','world':world}))
                return results
            registered=self.registry['worlds'].get(world)
            if not registered or registered['deleted']:raise SandboxError('World was not created by this run; live/foreign world access is refused')
            encoded=quote(world,safe='')
            try:info=self.api('/worlds/'+encoded)
            except urllib.error.HTTPError as error:
                if error.code==404 and op=='delete':
                    registered['deleted']=True;self.save();self.record(op,world,ok=True,alreadyAbsent=True);return {'deleted':world}
                raise
            if info.get('kind')!='sandbox' or info.get('ownerId')!=registered['ownerId']:raise SandboxError('Sandbox ownership verification failed')
            prefix='/worlds/'+encoded
            if op=='join':result=self.api(prefix+'/join',{})
            elif op=='read':
                resource=request.get('resource','state')
                if resource not in ['state','rules','reports','log']:raise SandboxError('Unknown sandbox read resource')
                result=self.api('/sandboxes/'+encoded+'/log' if resource=='log' else prefix+'/'+resource)
            elif op=='act':
                actions=request.get('actions')
                if not isinstance(actions,list) or not 1<=len(actions)<=8:raise SandboxError('Supply 1–8 ordinary sandbox actions')
                request_id=request.get('requestId')
                if not isinstance(request_id,str) or not 1<=len(request_id)<=80:raise SandboxError('A stable requestId is required for action retries')
                payload=json.dumps(actions,sort_keys=True);key=world+':'+request_id
                digest=hashlib.sha256(payload.encode()).hexdigest()
                previous=self.registry['requests'].get(key)
                if previous and previous!=digest:raise SandboxError('requestId reused with different actions')
                self.registry['requests'][key]=digest;self.save()
                prepared=[{**a,'clientId':'sbx-'+hashlib.sha256((key+':'+str(i)).encode()).hexdigest()[:32]} for i,a in enumerate(actions)]
                result=self.api(prefix+'/actions',{'actions':prepared,'returnState':True})
            elif op=='step':
                ticks=int(request.get('ticks',0))
                if not 1<=ticks<=3600:raise SandboxError('Step must be 1–3600 ticks')
                start=info['tick'];self.api('/sandboxes/'+encoded+'/control',{'action':'step','ticks':ticks})
                for _ in range(150):
                    result=self.api(prefix+'/state')
                    if result['world']['tick']>=start+ticks or result['world']['status']=='ended':break
                    time.sleep(.1)
                else:raise SandboxError('Sandbox step timed out')
            elif op=='delete':
                self.api('/sandboxes/'+encoded,method='DELETE');registered['deleted']=True;self.save();result={'deleted':world}
            else:raise SandboxError('Unknown sandbox operation')
            self.record(op,world,ok=True,requestId=request.get('requestId'),ticks=request.get('ticks'),actionTypes=[a.get('type') for a in request.get('actions',[])],actionResults=[{'ok':r.get('ok'),'code':r.get('error',{}).get('code')} for r in result.get('results',[])] if isinstance(result,dict) else [])
            return result
        except urllib.error.HTTPError as error:
            self.record(op,world,ok=False,error={'kind':'game-api','httpStatus':error.code})
            raise SandboxError(f'Sandbox API returned HTTP {error.code}; attempt recorded. Respect Retry-After before retrying.') from None
        except Exception as error:
            self.record(op,world,ok=False,error={'kind':'broker','message':str(error)[:300]})
            raise
