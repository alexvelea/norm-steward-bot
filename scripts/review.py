#!/usr/bin/env python3
"""Bounded, locked Codex strategic reviews. Run with --help for operator commands."""
import argparse, datetime, fcntl, json, os, pathlib, selectors, signal, subprocess, sys, time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'review'))
from usage import read_usage, budget_pause
from evidence import collect, settings, CONTROL
from deploy import activate, atomic
from progress import select_task, source_digest, assess, advance, runtime_change, snapshot, policy_change
from sandbox import Broker
ROOT=pathlib.Path(os.environ.get('STEWARD_REVIEW_REPO','/root/norm-steward-bot'))
DATA=pathlib.Path(os.environ.get('STEWARD_REVIEW_DIR','/var/lib/norm-steward-review'))
WORK=DATA/'worktree'
RUN_SECONDS=900

def load(path,default=None):
    try:return json.loads(path.read_text())
    except FileNotFoundError:return default

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def update(**values):
    state=load(DATA/'state.json',{});state.update(values);atomic(DATA/'state.json',state);return state

def safe(text):
    secrets=[]
    try:secrets.append(settings()['apiKey'])
    except Exception:pass
    try:secrets.append((CONTROL/'access-token.txt').read_text().strip())
    except OSError:pass
    for secret in secrets:
        if secret:text=text.replace(secret,'[REDACTED]')
    return text

def run_command(args,cwd=ROOT,timeout=180):
    completed=subprocess.run(args,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout)
    if completed.returncode:raise RuntimeError(safe(completed.stdout[-1600:]))
    return completed.stdout.strip()

def next_calendar(timestamp):return (int(timestamp)//1800+1)*1800

def run_agent(args,prompt,run,timeout=RUN_SECONDS):
    """Drain both pipes, redact before logging, terminate the entire process group on pause/time limit."""
    env=os.environ.copy()
    for key in ['OPENAI_API_KEY','CODEX_API_KEY','AZURE_OPENAI_API_KEY','STEWARD_KEY']:env.pop(key,None)
    env['STEWARD_REVIEW_RUN']=str(run.parent if run.name.startswith('attempt-') else run)
    env['STEWARD_REVIEW_TOOLS']=str(ROOT)
    process=subprocess.Popen(args,cwd=WORK,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    process.stdin.write(prompt.encode());process.stdin.close()
    selector=selectors.DefaultSelector()
    for stream,name in [(process.stdout,'events'),(process.stderr,'stderr')]:
        os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ,name)
    buffers={'events':b'','stderr':b''}
    start=time.monotonic();reason=None;usage=None
    with (run/'events.jsonl').open('w') as events,(run/'stderr.log').open('w') as errors:
        def retain(raw,name):
            nonlocal usage,reason
            clean=safe(raw.decode(errors='replace'));(events if name=='events' else errors).write(clean+'\n')
            if name=='events':
                try:
                    item=json.loads(clean)
                    if item.get('type')=='turn.completed':usage=item.get('usage')
                    if item.get('type') in ['error','turn.failed']:
                        message=clean.lower()
                        if any(word in message for word in ['usage limit','rate_limit','rate limit','quota','limit exceeded']):reason='budget-paused'
                        elif any(word in message for word in ['unauthorized','authentication','sign in','token expired','401']):reason='authentication-paused'
                except ValueError:pass
        try:
            while selector.get_map():
                if time.monotonic()-start>timeout or (DATA/'paused').exists():
                    reason='paused' if (DATA/'paused').exists() else 'timeout';break
                for key,_ in selector.select(.25):
                    chunk=os.read(key.fileobj.fileno(),65536);name=key.data
                    if not chunk:
                        if buffers[name]:retain(buffers[name],name);buffers[name]=b''
                        selector.unregister(key.fileobj);continue
                    buffers[name]+=chunk
                    while b'\n' in buffers[name]:
                        line,buffers[name]=buffers[name].split(b'\n',1);retain(line,name)
        finally:
            selector.close()
            if process.poll() is None:
                try:os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=10)
                except (ProcessLookupError,subprocess.TimeoutExpired):
                    try:os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
            process.wait();process.stdout.close();process.stderr.close()
    return reason or ('completed' if process.returncode==0 else 'failed'),usage

FORBIDDEN=('src/review/sandbox-client.ts','scripts/sandbox.py','AGENTS.md','src/rules/','src/shared/','scripts/review','deploy/','package.json','package-lock.json','.github/')
def allowed_changes(paths):return all(not any(p==prefix or p.startswith(prefix) for prefix in FORBIDDEN) and not p.startswith(('/', '..')) for p in paths)

def validate_report(report):
    if not isinstance(report,dict) or not isinstance(report.get('activate'),bool):return False
    return all(isinstance(report.get(k),str) for k in ['summary','expectedEffect','measuredOutcome','nextMeasure']) and isinstance(report.get('evidence'),list) and isinstance(report.get('backlog'),list) and isinstance(report.get('taskId'),str) and report.get('outcome') in ['implementation','experiment','instrumentation','blocked','no-change'] and isinstance(report.get('artifacts'),list) and isinstance(report.get('taskComplete'),bool) and report.get('verdict') in ['supports-change','rejects-change','inconclusive','not-applicable']

def review(probe=False):
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(DATA,0o700)
    lock=(DATA/'review.lock').open('a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:lock.close();return 'overlap-skipped'
    state=load(DATA/'state.json',{})
    if (DATA/'paused').exists():lock.close();return 'paused'
    if time.time()<state.get('retryAt',0):lock.close();return 'backoff'
    started=time.time();run=DATA/'runs'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');run.mkdir(parents=True,mode=0o700)
    try:
        try: auth=run_command(['codex','login','status'],timeout=20)
        except Exception: raise RuntimeError('Existing ChatGPT login unavailable; repair codex login on this machine')
        if 'ChatGPT' not in auth:raise RuntimeError('Unattended reviews require the existing ChatGPT login; run codex login interactively on this machine')
        usage=read_usage();atomic(run/'usage.json',usage)
        update(status='preparing',startedAt=now(),run=str(run),usage=usage,error=None,cleanupError=None,nextScheduledAt=next_calendar(started))
        retry=budget_pause(usage,time.time())
        if retry:
            update(status='budget-paused',retryAt=retry,error='Backend reports usage unavailable; will recheck after backoff.');return 'budget-paused'
        if not probe:
            atomic(run/'previous-state.json',state)
            collect(run/'evidence',details=True)
        if not WORK.exists():run_command(['git','worktree','add','-b','review/continuous',str(WORK),'master'])
        # Never reset durable progress or an unpublished local commit.
        if not run_command(['git','status','--porcelain'],cwd=WORK):run_command(['git','merge','--ff-only','master'],cwd=WORK)
        if not (WORK/'node_modules').exists():run_command(['npm','ci'],cwd=WORK,timeout=180)
        # Recover only worlds previously created by this reviewer, never unrelated owner sandboxes.
        for registry in sorted((DATA/'runs').glob('*/sandboxes.json')):
            previous=load(registry,{})
            if any(not w.get('deleted') for w in previous.get('worlds',{}).values()):
                try:Broker(registry.parent,WORK).call({'op':'cleanup'})
                except Exception as error:update(cleanupError=safe(str(error))[:500])
        task=None
        if not probe:
            backlog=load(DATA/'backlog.json',[])
            for item in backlog:
                if not item.get('id'):item['id']=select_task(None,[item])['id']
            atomic(DATA/'backlog.json',backlog)
            task=select_task(load(DATA/'work.json'),backlog)
            atomic(DATA/'work.json',task);update(activeTask=task)
        deadline=time.monotonic()+(60 if probe else RUN_SECONDS)
        assessment=None;report=None;outcome=None;before_digest=source_digest(WORK);before_snapshot=snapshot(WORK)
        for attempt in range(1,2 if probe else 3):
            attempt_dir=run/f'attempt-{attempt}';attempt_dir.mkdir(mode=0o700)
            if probe:
                prompt='Read no files and run no tools. Reply with exactly UNATTENDED_AUTH_OK.'
                args=['codex','exec','--ignore-user-config','-s','read-only','--json','-C',str(WORK),'-o',str(attempt_dir/'last.txt'),'-']
            else:
                correction='' if attempt==1 else f"\nCORRECTIVE RETRY: {assessment['error'] or 'No substantive implementation or managed sandbox experiment occurred.'} You own obtaining the missing evidence. Do not repeat offline snapshots or unchanged test suites. Execute the experiment or implement the bounded candidate now. Previous result: {run}/attempt-1/result.json."
                prompt=(ROOT/'scripts/review/prompt.md').read_text()+f'\nPinned task: {DATA}/work.json; previous state {run}/previous-state.json; backlog {DATA}/backlog.json; previous report {state.get("latestReportPath","none")}; usage {run}/usage.json; gameplay evidence {run}/evidence; experiment artifacts {run}. Remaining total seconds: {max(0,int(deadline-time.monotonic()))}.\n'+correction
                args=['codex','exec','--ignore-user-config','-c','model_reasoning_effort="high"','--dangerously-bypass-approvals-and-sandbox','--json','-C',str(WORK),'--output-schema',str(ROOT/'scripts/review/result.schema.json'),'-o',str(attempt_dir/'result.json'),'-']
            update(status='running',retryAt=0,attempt=attempt)
            outcome,tokens=run_agent(args,prompt,attempt_dir,timeout=max(1,deadline-time.monotonic()))
            update(lastUsage=tokens)
            last=attempt_dir/('last.txt' if probe else 'result.json')
            if last.exists():last.write_text(safe(last.read_text()))
            if probe or outcome!='completed':break
            report=load(last)
            if not validate_report(report):raise RuntimeError('Review returned an invalid work report; no activation')
            paths=run_command(['git','diff','--name-only','master'],cwd=WORK).splitlines()+run_command(['git','ls-files','--others','--exclude-standard'],cwd=WORK).splitlines()
            after_snapshot=snapshot(WORK)
            changed_paths=[p for p in set(before_snapshot)|set(after_snapshot) if before_snapshot.get(p)!=after_snapshot.get(p)]
            assessment=assess(report,task,paths,run,WORK,source_digest(WORK)!=before_digest,changed_paths)
            task=advance(task,assessment,report);atomic(DATA/'work.json',task);update(activeTask=task)
            atomic(attempt_dir/'assessment.json',assessment)
            if not assessment['needsRetry'] or attempt==2 or deadline-time.monotonic()<60:break
            actual=read_usage();atomic(run/'usage-retry.json',actual)
            retry=budget_pause(actual,time.time())
            if retry:update(status='budget-paused',usage=actual,retryAt=retry);outcome='budget-paused';break
        # Preserve the familiar top-level report/log locations for operators and history.
        if report is not None:atomic(run/'result.json',report)
        if outcome=='completed' and not probe:
            task['lastRun']=str(run);atomic(DATA/'work.json',task)
        # Last-message output is also redacted before retaining it.
        last=last if probe else run/'result.json'
        if last.exists():last.write_text(safe(last.read_text()))
        if outcome!='completed':
            if outcome=='budget-paused':
                actual=read_usage();atomic(run/'usage-after.json',actual);update(usage=actual)
                retry=budget_pause(actual,time.time())
                if retry: update(status=outcome,error='Codex usage exhausted; progress retained.',retryAt=retry);return outcome
            failures=state.get('failures',0)+1;delay=min(21600,1800*2**min(failures-1,4))
            update(status=outcome,error='Review stopped; worktree and logs preserved.',retryAt=time.time()+delay,failures=failures);return outcome
        if probe:
            if not last.exists() or 'UNATTENDED_AUTH_OK' not in last.read_text():raise RuntimeError('Unattended probe returned no confirmation')
            update(status='idle',probe={'at':now(),'ok':True,'run':str(run)},error=None,failures=0,finishedAt=now());return 'probe-ok'
        report=load(last)
        if not validate_report(report):raise RuntimeError('Review returned an invalid report; work is preserved, no deployment')
        atomic(DATA/'backlog.json',report['backlog']);atomic(run/'report.json',report)
        update(latestReview=report,latestReportPath=str(run/'report.json'),finishedAt=now(),failures=0,status='verifying',error=None)
        history=state.get('reviewHistory',[])
        row={'at':now(),'summary':report['summary'],'taskId':task['id'],'outcome':assessment['kind'],'activate':False}
        history=(history+[row])[-24:]
        update(reviewHistory=history)
        if assessment['needsRetry']:
            update(status='stalled',error='Review made no verified task progress. The pinned task remains active; next review must execute its experiment or implementation.',activeTask=task)
            return 'stalled'
        if assessment['kind']=='blocked':
            waits=[e.get('at',time.time())+e.get('retryAfterSeconds',0) for e in assessment['receipt']['failedAttempts'] if e.get('retryAfterSeconds')]
            update(status='blocked',error=safe(report['blocker'].get('message','Experiment API failed')),retryAt=max(waits) if waits else time.time()+1800,activeTask=task)
            return 'blocked'
        if not report['activate'] or (DATA/'paused').exists():
            update(status='paused' if (DATA/'paused').exists() else 'in-progress',activeTask=task);return 'in-progress'
        if run_command(['git','status','--porcelain'],cwd=ROOT):raise RuntimeError('Live source checkout has uncommitted work; candidate retained')
        paths=run_command(['git','diff','--name-only','master'],cwd=WORK).splitlines()+run_command(['git','ls-files','--others','--exclude-standard'],cwd=WORK).splitlines()
        if not allowed_changes(paths):raise RuntimeError('Candidate touches protected scheduler/rules/dependency files; manual review required')
        if not paths:update(status='observed');return 'observed'
        # Verify secrets before tests/commit; private evidence belongs outside the worktree.
        diff=run_command(['git','diff','master'],cwd=WORK)
        if safe(diff)!=diff:raise RuntimeError('Credential detected in candidate diff')
        for path in paths:
            file=WORK/path
            if file.is_file() and file.stat().st_size<2_000_000:
                raw=file.read_text(errors='replace')
                if safe(raw)!=raw:raise RuntimeError('Credential detected in candidate files')
        for args in [['npm','run','typecheck'],['npm','test'],['npm','run','build:web']]:
            output=run_command(args,cwd=WORK,timeout=180);(run/(args[-1]+'.log')).write_text(safe(output))
        if (DATA/'paused').exists():update(status='paused');return 'paused'
        run_command(['git','add','--all'],cwd=WORK)
        if run_command(['git','diff','--cached','--name-only'],cwd=WORK):run_command(['git','-c','user.name=Steward Reviewer','-c','user.email=steward@localhost','commit','-m',report['summary'][:120]],cwd=WORK)
        commit=run_command(['git','rev-parse','HEAD'],cwd=WORK)
        update(candidateCommit=commit,status='publishing')
        # Fast-forward only: a concurrent owner commit or remote change is preserved, never overwritten.
        run_command(['git','push','origin','HEAD:master'],cwd=WORK,timeout=60)
        run_command(['git','merge','--ff-only',commit],cwd=ROOT)
        update(status='deploying')
        if runtime_change(paths):
            deployment=activate(WORK,commit)
            can_complete=task.get('delivery','gameplay')!='gameplay' or policy_change(paths)
            can_complete=can_complete and all(path in paths for path in task.get('requiredPaths',[]))
            if report.get('taskComplete') and can_complete:
                task['stage']='complete'
                pending=load(DATA/'backlog.json',[])
                pending=[b for b in pending if b.get('id')!=task['id'] and b.get('title')!=task['title']]
                atomic(DATA/'backlog.json',pending)
            row.update(outcome='gameplay-shipped' if policy_change(paths) else 'ui-shipped',activate=True,commit=commit)
            update(deployment=deployment)
            if policy_change(paths):update(lastGameplayChange=row)
        else:
            row.update(outcome='instrumentation-published',commit=commit)
        atomic(DATA/'work.json',task)
        update(status='idle',activeTask=task,reviewHistory=history,finishedAt=now(),nextScheduledAt=next_calendar(time.time()),retryAt=0)
        return 'deployed' if runtime_change(paths) else 'published'
    except Exception as error:
        message=safe(str(error))[:1800];auth_error='ChatGPT login' in message or 'authentication' in message.lower()
        update(status='authentication-paused' if auth_error else 'error',error=message,finishedAt=now(),retryAt=time.time()+3600)
        return 'error'
    finally:
        if not probe:
            try:Broker(run,WORK).call({'op':'cleanup'})
            except Exception as error:update(cleanupError=safe(str(error))[:500])
        lock.close()

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['run','probe','status','pause','resume','collect','usage','deploy']);parser.add_argument('--output');parser.add_argument('--commit');parser.add_argument('--details',action='store_true');args=parser.parse_args()
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    if args.command=='pause':(DATA/'paused').write_text(now());print('Reviews paused. Gameplay unchanged.');return
    if args.command=='resume':(DATA/'paused').unlink(missing_ok=True);print('Reviews resumed. Quota/auth backoff remains in effect.');return
    if args.command=='status':print(json.dumps({**load(DATA/'state.json',{}),'paused':(DATA/'paused').exists(),'backlog':load(DATA/'backlog.json',[])},indent=2));return
    if args.command=='usage':print(json.dumps(read_usage(),indent=2));return
    if args.command=='collect':collect(args.output or str(DATA/'manual-evidence'),details=args.details);print('Read-only evidence collected.');return
    if args.command=='deploy':print(json.dumps(activate(ROOT,args.commit or run_command(['git','rev-parse','HEAD']))));return
    print(review(probe=args.command=='probe'))
def interrupted(_signal,_frame):
    update(status='interrupted',error='Review service interrupted; worktree preserved.',finishedAt=now(),retryAt=time.time()+1800)
    raise SystemExit(0)
if __name__=='__main__':
    signal.signal(signal.SIGTERM,interrupted)
    main()
