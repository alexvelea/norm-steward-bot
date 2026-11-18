#!/usr/bin/env python3
"""Run committed policies in owner-only sandboxes: snapshots, action log, reports and a milestone timeline per run. See docs/sandbox.md."""
import argparse, fcntl, json, os, pathlib, signal, subprocess, sys, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'scripts/sandbox'),str(ROOT/'scripts/review')]
from deploy import atomic
from broker import Broker, fingerprint
DATA=pathlib.Path(os.environ.get('STEWARD_REVIEW_DIR','/var/lib/norm-steward-review'))
DEFAULT_HOUSE_BOTS='warden=2,reaver=2,sovereign=2'
HOUSE_BOT_KINDS=('warden','reaver','sovereign')
MAX_HOUSE_BOTS=12
ROUND_TICKS=10800

def read(path):return json.loads(path.read_text())

def parse_house_bots(text):
    house_bots={kind:0 for kind in HOUSE_BOT_KINDS}
    if text.strip()=='none':return house_bots
    seen=set()
    for entry in text.split(','):
        if '=' not in entry:raise ValueError('house-bots entries must use kind=N')
        kind,count=entry.split('=',1)
        kind=kind.strip();count=count.strip()
        if kind not in house_bots:raise ValueError(f'Unknown house-bot kind: {kind}')
        if kind in seen:raise ValueError(f'Duplicate house-bot kind: {kind}')
        if not count.isascii() or not count.isdecimal():raise ValueError(f'Invalid house-bot count for {kind}: {count}')
        house_bots[kind]=int(count);seen.add(kind)
    if sum(house_bots.values())>MAX_HOUSE_BOTS:raise ValueError(f'Total house bots cannot exceed {MAX_HOUSE_BOTS}')
    return house_bots

def valid_run(directory,spec):
    try:
        value=read(directory/'result.json')
        keep=bool(spec.get('keep'))
        if not(value.get('passed') and bool(value.get('deleted'))!=keep and value.get('lastTick')==spec['ticks']):return False
        if value.get('seed')!=spec['seed'] or value.get('rulesVersion') is None:return False
        checkpoints=value.get('checkpoints',[])
        if [r['tick'] for r in checkpoints]!=list(range(0,spec['ticks'],spec['snapshotTicks']))+[spec['ticks']]:return False
        if [json.loads(line) for line in (directory/'snapshots.jsonl').read_text().splitlines()]!=checkpoints:return False
        ops=set()
        for line in (directory/'sandbox-events.jsonl').read_text().splitlines():
            event=json.loads(line)
            if event.get('worldId')==value['worldId'] and event.get('ok') and event.get('fingerprint')==spec['fingerprint']:
                ops.add(event['op'])
        return ({'create','step'} if keep else {'create','step','delete'})<=ops
    except (OSError,ValueError,KeyError,TypeError):return False

def run(ref='HEAD',hours=1,snapshot_ticks=300,seed=73430,working_tree=None,house_bots=None,keep=False):
    if house_bots is None:house_bots=parse_house_bots(DEFAULT_HOUSE_BOTS)
    ticks=round(hours*3600)
    if keep:ticks=min(ticks,ROUND_TICKS-1)  # an ended world cannot be opened in the dashboard
    if not 600<=ticks<=10800:raise ValueError('Use a horizon of 600–10800 game ticks (up to 3 hours)')
    if not 1<=snapshot_ticks<=ticks:raise ValueError('snapshot-ticks must be between 1 and the horizon')
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (DATA/'experiment.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Another sandbox run is active') from None
        if (DATA/'paused').exists():raise RuntimeError('Sandbox runs are paused with strategic reviews')
        revision=subprocess.check_output(['git','rev-parse',ref+'^{commit}'],cwd=working_tree or ROOT,text=True).strip()
        directory=DATA.resolve()/'experiments/runs'/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+uuid.uuid4().hex[:6])
        directory.mkdir(parents=True,mode=0o700);source=pathlib.Path(working_tree).resolve() if working_tree else directory/'source'
        spec={'id':directory.name,'status':'running','revision':revision,'ticks':ticks,'snapshotTicks':snapshot_ticks,'seed':seed,'houseBots':house_bots,'startedAt':time.time()}
        if working_tree is None:spec['ref']=ref
        if keep:spec['keep']=True
        atomic(directory/'run.json',spec)
        created=False
        try:
            if working_tree is None:
                subprocess.run(['git','worktree','add','--detach',str(source),revision],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
                created=True
                (source/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
            spec['workingTree']=working_tree is not None
            spec['fingerprint']=fingerprint(source);atomic(directory/'run.json',spec)
            env={**{k:os.environ[k] for k in ['PATH','HOME','LANG','TMPDIR','STEWARD_CONTROL_DIR'] if k in os.environ},'STEWARD_REVIEW_DIR':str(DATA.resolve()),'STEWARD_REVIEW_RUN':str(directory.resolve()),'STEWARD_REVIEW_TOOLS':str(ROOT),
                 'STEWARD_EXPERIMENT_SOURCE':str(source),'STEWARD_EXPERIMENT_TICKS':str(ticks),'STEWARD_EXPERIMENT_SEED':str(seed),'STEWARD_EXPERIMENT_SNAPSHOT_TICKS':str(snapshot_ticks),'STEWARD_EXPERIMENT_HOUSE_BOTS':json.dumps(house_bots),**({'STEWARD_EXPERIMENT_KEEP':'1'} if keep else {})}
            with (directory/'worker.log').open('a') as log:
                subprocess.run(['node','--import','tsx',str(ROOT/'scripts/sandbox/runner.mts')],cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=5400,check=True)
            if not valid_run(directory,spec):raise RuntimeError('Run did not produce complete owned-world receipts and snapshots')
            if fingerprint(source)!=spec['fingerprint']:raise RuntimeError('Policy changed during sandbox run')
            spec['status']='complete'
        except BaseException as error:
            spec.update(status='failed',error=type(error).__name__)
            raise RuntimeError(f'Sandbox run failed; inspect {directory}/worker.log and run.json') from error
        finally:
            try:
                if spec.get('fingerprint'):Broker(directory,source).call({'op':'cleanup','kept':spec['status']!='complete'})
            except Exception:spec['cleanupError']='Owned sandbox cleanup needs retry with scripts/sandbox/broker-cli.mts'
            try:
                if created and (source/'node_modules').is_symlink():(source/'node_modules').unlink()
                if created:subprocess.run(['git','worktree','remove',str(source)],cwd=ROOT,check=True)
            finally:
                spec['finishedAt']=time.time();atomic(directory/'run.json',spec)
        return directory

def runs_directory():return DATA.resolve()/'experiments/runs'

def delete(run_id):
    """Delete the world a --keep run left open."""
    directory=runs_directory()/run_id
    if not (directory/'sandboxes.json').exists():raise ValueError(f'No sandbox run {run_id}')
    Broker(directory,ROOT).call({'op':'cleanup','kept':True})
    spec=read(directory/'run.json');spec.pop('keep',None);spec['deletedAt']=time.time();atomic(directory/'run.json',spec)

def compare(directories):
    """One row per major milestone, one column per run; cells are the tick it was first reached."""
    runs=[(read(d/'run.json'),read(d/'result.json')) for d in directories]
    refs={spec.get('ref','working tree') for spec,_ in runs};seeds={spec['seed'] for spec,_ in runs}
    def name(spec):
        ref=spec.get('ref','working tree')
        return ref if len(seeds)==1 and len(refs)>1 else f'seed {spec["seed"]}' if len(refs)==1 and len(seeds)>1 else f'{ref} @{spec["seed"]}'
    columns=[{m['key']:m['tick'] for m in result.get('timeline',[]) if m['major']} for _,result in runs]
    keys=sorted({k for c in columns for k in c},key=lambda k:(min(c[k] for c in columns if k in c),k))
    lines=['| Milestone | '+' | '.join(name(spec) for spec,_ in runs)+' |','|---|'+'---:|'*len(runs)]
    lines+=[f'| {k} | '+' | '.join(str(c.get(k,'—')) for c in columns)+' |' for k in keys]
    return '\n'.join(lines)+'\n'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    selection=parser.add_mutually_exclusive_group()
    selection.add_argument('--ref',nargs='+',default=['HEAD'],help='Committed policy refs (default HEAD; dirty changes are not included). Several refs run one after another and end in one comparison table')
    selection.add_argument('--working-tree',action='store_true',help='Use the current directory, including uncommitted policy edits; do not edit it during the run')
    selection.add_argument('--compare',nargs='+',metavar='RUN',help='Print the comparison table for finished runs, by run id')
    selection.add_argument('--delete',metavar='RUN',help='Delete the world a --keep run left open')
    parser.add_argument('--hours',type=float,default=1)
    parser.add_argument('--snapshot-ticks',type=int,default=300)
    parser.add_argument('--seed',type=int,nargs='+',default=[73430],help='World seeds; every ref runs on every seed')
    parser.add_argument('--house-bots',default=DEFAULT_HOUSE_BOTS,help='House bots as kind=N pairs (default blitz: warden=2,reaver=2,sovereign=2), or none')
    parser.add_argument('--keep',action='store_true',help='Leave the world paused at the last tick for the dashboard; remove it later with --delete RUN')
    args=parser.parse_args()
    signal.signal(signal.SIGTERM,lambda *_:sys.exit('Sandbox runner interrupted'))
    try:
        if args.delete:delete(args.delete);return
        if args.compare:print(compare([runs_directory()/run for run in args.compare]),end='');return
        house_bots=parse_house_bots(args.house_bots);finished=[];failed=[]
        for ref in args.ref:
            for seed in args.seed:
                try:directory=run(ref,args.hours,args.snapshot_ticks,seed,pathlib.Path.cwd() if args.working_tree else None,house_bots,args.keep)
                except RuntimeError as error:
                    if len(args.ref)*len(args.seed)==1:raise
                    failed.append(f'{ref} @{seed}: {error}');continue
                finished.append(directory);print(directory,flush=True)
                if args.keep:print('Kept world',read(directory/'result.json')['worldId'],'- delete with --delete',directory.name,flush=True)
        if len(finished)==1:print((finished[0]/'timeline.md').read_text(),end='')
        elif finished:print(compare(finished),end='')
        if failed:parser.exit(1,'\n'.join(failed)+'\n')
    except (OSError,ValueError,KeyError,RuntimeError) as error:parser.exit(1,str(error)+'\n')

if __name__=='__main__':main()
