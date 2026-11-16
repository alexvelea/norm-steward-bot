"""Small durable work contract and evidence-based progress classification."""
import hashlib, json, pathlib, re
from sandbox import fingerprint

RUNTIME=('src/advisors/','src/control/','web/src/','scripts/serve.mjs')
EXPERIMENT_JOBS=pathlib.Path('/var/lib/norm-steward-review/experiments/jobs')
POLICY=('src/advisors/','src/control/controller.ts','src/control/types.ts')
def runtime_change(paths):return any(any(p.startswith(prefix) for prefix in RUNTIME) for p in paths)
def policy_change(paths):return any(any(p.startswith(prefix) for prefix in POLICY) for p in paths)
def source_digest(work):
    digest=hashlib.sha256()
    for folder in ['src','test','web/src','web/test','scripts']:
        for path in sorted((pathlib.Path(work)/folder).rglob('*')):
            if path.is_file() and path.suffix in ['.ts','.tsx','.py','.mjs']:
                digest.update(str(path.relative_to(work)).encode());digest.update(path.read_bytes())
    return digest.hexdigest()

def snapshot(work):
    result={}
    for folder in ['src','test','web/src','web/test','scripts']:
        for path in (pathlib.Path(work)/folder).rglob('*'):
            if path.is_file() and path.suffix in ['.ts','.tsx','.py','.mjs']:
                result[str(path.relative_to(work))]=hashlib.sha256(path.read_bytes()).hexdigest()
    return result

def select_task(previous,backlog):
    if previous and previous.get('stage')!='complete':return previous
    top=min(backlog,key=lambda b:b.get('priority',999)) if backlog else {'title':'Inspect gameplay and choose a justified improvement','nextStep':'Collect evidence and run one bounded experiment'}
    title=top['title'];task_id=top.get('id') or re.sub(r'[^a-z0-9]+','-',title.lower()).strip('-')[:70]
    return {'id':task_id,'title':title,'acceptance':top.get('acceptance','Answer one concrete gameplay question with matched experiments, measured tradeoffs and a decision. Ship a policy change only if supported; a verified negative result can complete research.'),'nextAction':top['nextStep'],'delivery':top.get('delivery','research'),'requiredPaths':top.get('requiredPaths',[]),'stage':'implement','attempts':0,'noProgressStreak':0,'instrumentationRuns':0}

def events(directory):
    path=pathlib.Path(directory)/'sandbox-events.jsonl';result=[]
    if path.exists():
        for line in path.read_text().splitlines():
            try:result.append(json.loads(line))
            except ValueError:pass
    return result

def sandbox_evidence(run,work):
    entries=events(run);current=fingerprint(work)
    created={e['worldId'] for e in entries if e.get('op')=='create' and e.get('ok') and e.get('fingerprint')==current}
    advanced={e['worldId'] for e in entries if e.get('op')=='step' and e.get('ok') and e.get('fingerprint')==current}
    acted={e['worldId'] for e in entries if e.get('op')=='act' and e.get('ok') and e.get('fingerprint')==current and any(r.get('ok') for r in e.get('actionResults',[]))}
    return {'worlds':sorted(created&advanced),'successfulActionWorlds':sorted(created&acted),'failedAttempts':[e for e in entries if e.get('ok') is False and e.get('op')!='rate-limit']}

def valid_artifacts(report,run,work):
    roots=[pathlib.Path(run).resolve(),pathlib.Path(work).resolve()]
    found=[]
    for name in report.get('artifacts',[]):
        path=pathlib.Path(name)
        if not path.is_absolute():path=pathlib.Path(work)/path
        path=path.resolve()
        if path.is_file() and any(path.is_relative_to(root) for root in roots):found.append(str(path))
    return found

def queued_research(report,task):
    """Only the trusted persistent worker's immutable snapshots and broker receipts count."""
    root=EXPERIMENT_JOBS.resolve()
    for name in report.get('artifacts',[]):
        path=pathlib.Path(name).resolve()
        if path.name not in ['job.json','comparison.json'] or path.parent.parent!=root:continue
        job=path.parent
        try:
            spec=json.loads((job/'job.json').read_text())
            if spec['id'] in task.get('completedExperiments',[]):continue
            if spec['status'] in ['queued','running']:return {'state':'waiting','job':spec['id']}
            summary=json.loads((job/'comparison.json').read_text())
            if spec['status']!='complete' or summary.get('passed') is not True:continue
            cases=summary.get('cases',[])
            if len(cases)!=2:continue
            valid=True;versions=set()
            for policy in ['baseline','candidate']:
                case=job/policy;value=json.loads((case/'result.json').read_text())
                receipt=sandbox_evidence(case,case/'source');versions.add(value.get('rulesVersion'))
                valid &= fingerprint(case/'source')==spec[policy+'Fingerprint'] and value.get('passed') is True and value.get('deleted') is True and value.get('lastTick')==spec['ticks'] and value.get('seed')==spec['seed'] and value.get('worldId') in receipt['worlds'] and value.get('worldId') in receipt['successfulActionWorlds']
            if valid and len(versions)==1 and None not in versions:return {'state':'complete','job':spec['id'],'candidateFingerprint':spec['candidateFingerprint'],'rulesVersion':next(iter(versions))}
        except (OSError,ValueError,KeyError,TypeError):continue
    return None

def assess(report,task,paths,run,work,changed,changed_paths=None):
    if report.get('taskId')!=task['id']:raise ValueError('Review changed the pinned work item instead of completing it')
    artifacts=valid_artifacts(report,run,work);receipt=sandbox_evidence(run,work)
    comparisons=[]
    for path in artifacts:
        if pathlib.Path(path).suffix!='.json':continue
        try:
            value=json.loads(pathlib.Path(path).read_text());cases=value.get('cases',value.get('results',[]))
            matching=[c for c in cases if isinstance(c,dict) and c.get('worldId') in receipt['worlds'] and c.get('policy') in ['baseline','candidate']]
            if value.get('passed') is True and {'baseline','candidate'}<=set(c['policy'] for c in matching):comparisons.append(path)
        except (ValueError,AttributeError,TypeError):pass
    experimented=len(receipt['worlds'])>=2 and bool(receipt['successfulActionWorlds']) and bool(comparisons)
    worker=queued_research(report,task)
    current_rules=None
    try:current_rules=json.loads((pathlib.Path(run)/'evidence/rules.json').read_text()).get('version')
    except (OSError,ValueError):pass
    if worker and worker['state']=='complete' and worker['candidateFingerprint']==fingerprint(work) and current_rules==worker['rulesVersion']:experimented=True
    research=worker if task.get('delivery')=='research' and not report.get('activate') else None
    has_runtime=runtime_change(paths if changed_paths is None else changed_paths)
    real_blocker=bool(report.get('blocker')) and bool(receipt['failedAttempts'])
    relevant=has_runtime and (task.get('delivery','gameplay')!='gameplay' or policy_change(paths if changed_paths is None else changed_paths))
    if research:kind='research-complete' if research['state']=='complete' and report.get('verdict') in ['supports-change','rejects-change'] else 'experiment-waiting'
    elif relevant and changed:kind='implementation'
    elif experimented:kind='experiment'
    elif changed and paths:kind='instrumentation'
    elif real_blocker:kind='blocked'
    else:kind='no-progress'
    credit=kind in ['implementation','experiment','research-complete','experiment-waiting'] or kind=='instrumentation' and task.get('instrumentationRuns',0)==0
    if report.get('activate') and policy_change(paths) and (not experimented or report.get('verdict')!='supports-change'):
        return {'kind':'validation-missing','credit':False,'needsRetry':True,'error':'Run the candidate against the current policy in two managed private sandboxes. Fresh broker receipts, a passed comparison artifact and supports-change verdict are required.','receipt':receipt}
    return {'kind':kind,'research':research,'credit':credit,'needsRetry':not credit and not real_blocker,'error':None,'receipt':receipt}

def advance(task,result,report):
    task=dict(task);task['attempts']=task.get('attempts',0)+1;task['lastOutcome']=result['kind']
    task['noProgressStreak']=0 if result['credit'] else task.get('noProgressStreak',0)+1
    if result['kind']=='instrumentation':task['instrumentationRuns']=task.get('instrumentationRuns',0)+1
    if result['kind']=='research-complete':
        task['stage']='complete';task['completedExperiments']=task.get('completedExperiments',[])+[result['research']['job']]
    elif result['kind']=='experiment-waiting':task['stage']='experiment'
    elif result['kind']=='experiment':task['stage']='implement' if report.get('verdict')=='supports-change' else 'rethink'
    elif result['kind']=='implementation':task['stage']='verify'
    task['nextAction']=report.get('nextMeasure') or task['nextAction']
    return task

def delivered(task,report,paths,deployment):
    result=dict(task);result['lastDeployedCommit']=deployment['commit']
    ready=report.get('implementationComplete',report.get('taskComplete',False))
    matches=result.get('delivery','gameplay')!='gameplay' or policy_change(paths)
    if deployment.get('status')=='healthy' and ready and matches and all(p in paths for p in result.get('requiredPaths',[])):
        result['stage']='complete'
    return result
