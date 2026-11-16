#!/usr/bin/env python3
"""Durable, single-worker private strategy comparisons; no model calls or live actions."""
import argparse, fcntl, hashlib, io, json, os, pathlib, shutil, subprocess, sys, tarfile, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/review'))
from deploy import atomic
from sandbox import Broker, fingerprint
DATA=pathlib.Path(os.environ.get('STEWARD_REVIEW_DIR','/var/lib/norm-steward-review'))
JOBS=DATA/'experiments/jobs'
def read(p,default=None):
    try:return json.loads(p.read_text())
    except FileNotFoundError:return default

def submit(baseline,candidate,hypothesis,metric,ticks=7200,seed=73430):
    JOBS.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (JOBS/'.submit.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        return _submit(baseline,candidate,hypothesis,metric,ticks,seed)

def _submit(baseline,candidate,hypothesis,metric,ticks=7200,seed=73430):
    if not 600<=ticks<=10800:raise ValueError('Use 600–10800 game ticks')
    if not hypothesis.strip() or not metric.strip():raise ValueError('State a hypothesis and decision metric')
    JOBS.mkdir(parents=True,exist_ok=True,mode=0o700)
    revision=subprocess.check_output(['git','rev-parse',baseline+'^{commit}'],cwd=ROOT,text=True).strip()
    candidate_hash=fingerprint(pathlib.Path(candidate).resolve())
    for old in sorted(JOBS.glob('*/job.json')):
        previous=read(old)
        if previous.get('status') in ['queued','running','complete'] and (previous.get('baselineCommit'),previous.get('candidateFingerprint'),previous.get('ticks'),previous.get('seed'))==(revision,candidate_hash,ticks,seed):return old.parent
    job=JOBS/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+uuid.uuid4().hex[:6]);job.mkdir(mode=0o700)
    revision=subprocess.check_output(['git','rev-parse',baseline+'^{commit}'],cwd=ROOT,text=True).strip()
    for policy in ['baseline','candidate']:
        case=job/policy;source=case/'source';source.mkdir(parents=True)
        if policy=='baseline':
            data=subprocess.check_output(['git','archive',revision,'src'],cwd=ROOT)
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:archive.extractall(source,filter='data')
        else:shutil.copytree(pathlib.Path(candidate).resolve()/'src',source/'src')
        (source/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
        (source/'package.json').write_text('{"type":"module"}')
    if fingerprint(job/'candidate/source')!=candidate_hash:raise ValueError('Candidate changed while snapshotting; submit again after edits stop')
    spec={'id':job.name,'status':'queued','baselineCommit':revision,'candidateFingerprint':fingerprint(job/'candidate/source'),'baselineFingerprint':fingerprint(job/'baseline/source'),'hypothesis':hypothesis,'metric':metric,'ticks':ticks,'seed':seed,'createdAt':time.time(),'attempts':0}
    atomic(job/'job.json',spec);return job

def valid_case(case,spec,policy):
    value=read(case/'result.json',{})
    if not(value.get('passed') and value.get('deleted') and value.get('lastTick')==spec['ticks']):return False
    if value.get('seed')!=spec['seed'] or value.get('rulesVersion') is None:return False
    world=value.get('worldId');ops=set();paid=False
    for line in (case/'sandbox-events.jsonl').read_text().splitlines():
        event=json.loads(line)
        if event.get('worldId')==world and event.get('ok') and event.get('fingerprint')==spec[policy+'Fingerprint']:
            ops.add(event['op']);paid|=event['op']=='act' and any(r.get('ok') for r in event.get('actionResults',[]))
    return {'create','step','delete'}<=ops and paid

def summarize(job,spec):
    cases=[];initials=[]
    for policy in ['baseline','candidate']:
        if not valid_case(job/policy,spec,policy):raise ValueError('Incomplete or unmatched case receipts: '+policy)
        value=read(job/policy/'result.json');v=value['final']['villages'][0]
        iv=value['initial']['villages'][0]
        initials.append({k:iv[k] for k in ['buildings','units','resources','population','production']})
        spend={};busy=0
        for action in value['actions']:
            if not action['result'].get('ok'):continue
            kind='wall' if action['action'].get('building')=='wall' else action['action']['type']
            total=sum(action.get('proposal',{}).get('requirements',{}).values())
            spend[kind]=spend.get(kind,0)+total
            item=action['result'].get('data',{}).get('item',{})
            if action['action']['type']=='build':busy+=max(0,min(spec['ticks'],item.get('endTick',0))-max(0,item.get('startTick',0)))
        cases.append({'spendingTotalResources':spend,'constructionBusyTicks':busy,'constructionIdleTicks':spec['ticks']-busy,'policy':policy,'worldId':value['worldId'],'rulesVersion':value['rulesVersion'],'buildings':v['buildings'],'units':v['units'],'resources':v['resources'],'production':v['production'],'result':str(job/policy/'result.json')})
    if initials[0]!=initials[1]:raise ValueError('Initial assets differ between cases')
    if cases[0]['rulesVersion']!=cases[1]['rulesVersion']:raise ValueError('Rules changed between cases')
    result={'passed':True,'hypothesis':spec['hypothesis'],'metric':spec['metric'],'ticks':spec['ticks'],'seed':spec['seed'],'candidateFingerprint':spec['candidateFingerprint'],'cases':cases,'limitations':'One peaceful seed, no enemies. Completion is not proof the candidate is better; reviewer must interpret tradeoffs.'}
    atomic(job/'comparison.json',result);return result

def work_once():
    JOBS.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (DATA/'experiment.lock').open('a') as lock,(DATA/'review.lock').open('a') as review_lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            fcntl.flock(review_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return 'busy'
        if (DATA/'paused').exists():return 'paused'
        jobs=[p for p in sorted(JOBS.glob('*/job.json')) if read(p).get('status') in ['queued','running'] and read(p).get('retryAt',0)<=time.time()]
        if not jobs:return 'idle'
        path=jobs[0];job=path.parent;spec=read(path);spec.update(status='running',startedAt=time.time(),attempts=spec['attempts']+1);atomic(path,spec)
        try:
            for policy in ['baseline','candidate']:
                case=job/policy
                if valid_case(case,spec,policy):continue
                # A crashed process cannot safely resume its transient controller. Keep its evidence,
                # delete only its registered private world, then restart that case from tick zero.
                Broker(case,case/'source').call({'op':'cleanup'})
                if (case/'result.json').exists():
                    archive=case/('attempt-'+str(spec['attempts']-1));archive.mkdir(exist_ok=True)
                    for file in ['result.json','sandbox-events.jsonl','sandboxes.json','controller.json','checkpoints.md']:
                        if (case/file).exists():shutil.move(case/file,archive/file)
                env=os.environ.copy();env.update(STEWARD_REVIEW_RUN=str(case),STEWARD_REVIEW_TOOLS=str(ROOT),STEWARD_EXPERIMENT_SOURCE=str(case/'source'),STEWARD_EXPERIMENT_POLICY=policy,STEWARD_EXPERIMENT_TICKS=str(spec['ticks']),STEWARD_EXPERIMENT_SEED=str(spec['seed']))
                with (case/'worker.log').open('a') as log:
                    subprocess.run(['node','--import','tsx',str(ROOT/'scripts/experiment-policy.mts')],cwd=case/'source',env=env,stdout=log,stderr=subprocess.STDOUT,timeout=5400,check=True)
            summarize(job,spec);spec.update(status='complete',finishedAt=time.time(),error=None)
        except Exception as error:
            # Broker/runner logs do not contain credentials. Avoid retaining raw transport messages.
            spec.update(status='queued' if spec['attempts']<3 else 'failed',error=type(error).__name__+'; inspect private worker.log',retryAt=time.time()+1800)
        finally:
            for policy in ['baseline','candidate']:
                try:Broker(job/policy,job/policy/'source').call({'op':'cleanup'})
                except Exception:spec['cleanupError']='Private sandbox cleanup needs retry'
            atomic(path,spec)
        return spec['status']

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    s=sub.add_parser('submit');s.add_argument('--baseline',required=True);s.add_argument('--candidate',default=str(pathlib.Path.cwd()));s.add_argument('--hypothesis',required=True);s.add_argument('--metric',required=True);s.add_argument('--ticks',type=int,default=7200);s.add_argument('--seed',type=int,default=73430)
    sub.add_parser('run');sub.add_parser('status');a=p.parse_args()
    if a.command=='submit':print(submit(a.baseline,a.candidate,a.hypothesis,a.metric,a.ticks,a.seed))
    elif a.command=='run':print(work_once())
    else:print(json.dumps([read(p) for p in sorted(JOBS.glob('*/job.json'))],indent=2))
if __name__=='__main__':main()
