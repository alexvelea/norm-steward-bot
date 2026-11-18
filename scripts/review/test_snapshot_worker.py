import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import shutil
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('snapshot_worker', ROOT / 'scripts/experiments.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

SANDBOX = r"""
import {appendFileSync,readFileSync} from 'node:fs';
function receipt(op){const spec=JSON.parse(readFileSync(process.env.STEWARD_REVIEW_RUN+'/run.json','utf8'));appendFileSync(process.env.STEWARD_REVIEW_RUN+'/sandbox-events.jsonl',JSON.stringify({op,worldId:'offline',ok:true,fingerprint:spec.fingerprint,actionResults:[{ok:true}]})+'\n');}
let tick=0;
function village(id,name){return {id,name,buildings:{hall:1,lumberyard:tick>=75?2:1,quarry:1,mine:1},
 units:{home:{pikeman:10},away:{scout:2}},supportHere:[{units:{pikeman:3}}],supportAbroad:[],
 resources:{timber:100,stone:100,iron:100},resourcesMilli:{timber:100000,stone:100000,iron:100000},
 population:{used:12,max:100},production:{timber:10,stone:10,iron:10},
 buildQueue:tick<75?[{endTick:75}]:[],training:{barracks:[]},options:{build:[]}};}
function state(){return {world:{id:'offline',tick,status:tick===600?'ended':'paused'},player:{id:'owner'},
 villages:[village('v1','Capital'),village('v2','Outpost')],
 commands:{outgoing:tick<125?[{arrivalTick:125}]:[],incoming:[]}};}
export async function sandbox(r){
 if(r.op==='cleanup')return [];
 if(r.op==='step'){receipt('step');tick+=r.ticks;appendFileSync(process.env.STEWARD_REVIEW_RUN+'/steps.jsonl',tick+'\n');return state();}
 if(r.op==='act'){receipt('act');return {results:[{ok:true,data:{item:{startTick:0,endTick:75}}}],state:state()};}
 if(r.op==='read')return state();
 throw new Error('Unexpected offline operation '+r.op);
}
export function shutdownSandbox(){}
export class PrivateSandbox{
 static async create(){return new PrivateSandbox();}
 world={id:'offline'};
 constructor(){receipt('create');}
 join(){return state();} rules(){return {version:'offline'};} close(){receipt('delete');}
}
"""

CONTROLLER = r"""
export class Controller{
 static async create(storage,settings,remote){return new Controller(storage,remote);}
 constructor(storage,remote){this.storage=storage;this.remote=remote;this.sent=false;this.automatic=false;}
 async setAutomatic(v){this.automatic=v;}
 snapshot(){return {error:null,selection:{selected:null},proposals:[]};}
 async cycle(){
  if(!this.automatic||this.sent)return;
  const saved=await this.storage.load();
  const action={type:'build',building:'farm',village:'v2',clientId:'offline-action'};
  saved.pending={action,proposal:{requirements:{timber:10}}};await this.storage.save(saved);
  await this.remote({},'/worlds/offline/actions',{actions:[action]});this.sent=true;
 }
}
"""


class SnapshotWorkerTests(unittest.TestCase):
    def fixture(self, root):
        repo=root/'repo';(repo/'src/review').mkdir(parents=True);(repo/'src/control').mkdir();(repo/'scripts').mkdir()
        (repo/'package.json').write_text('{"type":"module"}')
        (repo/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
        (repo/'src/review/sandbox-client.ts').write_text(SANDBOX)
        shutil.copyfile(ROOT/'src/review/sandbox-actions.ts',repo/'src/review/sandbox-actions.ts')
        (repo/'src/review/sandbox-read.ts').write_text("export function privateRead(){throw new Error('Unexpected private read');}")
        (repo/'src/control/controller.ts').write_text(CONTROLLER)
        shutil.copyfile(ROOT/'scripts/sandbox-runner.mts',repo/'scripts/sandbox-runner.mts')
        subprocess.run(['git','init','-q',str(repo)],check=True)
        subprocess.run(['git','add','package.json','src','scripts'],cwd=repo,check=True)
        subprocess.run(['git','-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','offline policy'],cwd=repo,check=True)
        return repo

    def test_single_ref_runner_offline_snapshots_and_worktree_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);repo=self.fixture(root)
            with patch.object(worker,'ROOT',repo),patch.object(worker,'DATA',root/'data'):
                directory=worker.run(hours=1/6)
            value=json.loads((directory/'result.json').read_text())
            snapshots=[json.loads(line) for line in (directory/'snapshots.jsonl').read_text().splitlines()]
            self.assertEqual(snapshots,value['checkpoints'])
            self.assertEqual([r['tick'] for r in snapshots],[0,300,600])
            self.assertTrue(all(len(r['villages'])==2 for r in snapshots))
            self.assertEqual(snapshots[-1]['villages'][1]['units'],{'home':{'pikeman':10},'away':{'scout':2}})
            self.assertEqual(snapshots[-1]['villages'][1]['supportHere'],[{'units':{'pikeman':3}}])
            steps=[int(n) for n in (directory/'steps.jsonl').read_text().splitlines()]
            self.assertIn(75,steps);self.assertIn(125,steps)
            self.assertIn('Outpost',(directory/'checkpoints.md').read_text())
            self.assertFalse((directory/'source').exists())
            self.assertFalse((directory/'comparison.json').exists())
            spec=json.loads((directory/'run.json').read_text())
            self.assertEqual(spec['status'],'complete');self.assertTrue(worker.valid_run(directory,spec))
            self.assertEqual(subprocess.check_output(['git','worktree','list','--porcelain'],cwd=repo,text=True).count('worktree '),1)
            (directory/'snapshots.jsonl').write_text('')
            self.assertFalse(worker.valid_run(directory,spec))

    def test_working_tree_custom_cadence_and_failure_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);repo=self.fixture(root)
            with patch.object(worker,'ROOT',repo),patch.object(worker,'DATA',root/'data'):
                directory=worker.run(hours=1/6,snapshot_ticks=150,working_tree=repo)
                rows=json.loads((directory/'result.json').read_text())['checkpoints']
                self.assertEqual([r['tick'] for r in rows],[0,150,300,450,600])
                self.assertTrue((repo/'node_modules').is_symlink())
                (repo/'src/control/controller.ts').write_text("export class Controller{static async create(){throw new Error('offline failure');}}")
                with self.assertRaisesRegex(RuntimeError,'Sandbox run failed'):worker.run(hours=1/6,working_tree=repo)
                failed=sorted((root/'data/experiments/runs').glob('*/run.json'))
                self.assertEqual(sorted(json.loads(p.read_text())['status'] for p in failed),['complete','failed'])

    def test_action_quota_retry_preserves_pending_journal_and_snapshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);repo=self.fixture(root)
            sandbox=SANDBOX.replace('let tick=0;', 'let tick=0, rejected=false;')
            sandbox=sandbox.replace("if(r.op==='act'){receipt('act');", """if(r.op==='act'){
 const pending=JSON.parse(readFileSync(process.env.STEWARD_REVIEW_RUN+'/controller.json','utf8')).pending;
 if(JSON.stringify(pending.action)!==JSON.stringify(r.actions[0]))throw new Error('missing pending journal');
 appendFileSync(process.env.STEWARD_REVIEW_RUN+'/action-ids.jsonl',JSON.stringify(r.requestId)+'\\n');
 receipt('act');
 if(!rejected){rejected=true;return {results:[{ok:false,error:{code:'RATE_LIMITED',details:{retryAfterMs:1}}}],state:state()};}
""")
            (repo/'src/review/sandbox-client.ts').write_text(sandbox)
            with patch.object(worker,'ROOT',repo),patch.object(worker,'DATA',root/'data'):
                directory=worker.run(hours=1/6,working_tree=repo)
            value=json.loads((directory/'result.json').read_text())
            self.assertTrue(value['passed'])
            self.assertEqual([a['result']['ok'] for a in value['actions']],[False,True])
            self.assertEqual((directory/'action-ids.jsonl').read_text().splitlines(),['"offline-action"']*2)
            self.assertEqual([r['tick'] for r in value['checkpoints']],[0,300,600])

    def test_lock_pause_and_invalid_horizons(self):
        import fcntl
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            with patch.object(worker,'DATA',root),patch.object(worker.subprocess,'run') as command:
                with (root/'experiment.lock').open('a') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    with self.assertRaisesRegex(RuntimeError,'active'):worker.run()
                (root/'paused').touch()
                with self.assertRaisesRegex(RuntimeError,'paused'):worker.run()
                with self.assertRaises(ValueError):worker.run(hours=0)
                with self.assertRaises(ValueError):worker.run(snapshot_ticks=0)
                command.assert_not_called()

    def test_early_round_end_preserves_final_state_without_more_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);repo=self.fixture(root)
            (repo/'src/review/sandbox-client.ts').write_text(SANDBOX.replace("status:tick===600?'ended':'paused'", "status:tick>=125?'ended':'paused'"))
            with patch.object(worker,'ROOT',repo),patch.object(worker,'DATA',root/'data'):
                with self.assertRaisesRegex(RuntimeError,'Sandbox run failed'):
                    worker.run(hours=1/6,working_tree=repo)
            directory=next((root/'data/experiments/runs').iterdir())
            value=json.loads((directory/'result.json').read_text())
            self.assertFalse(value['passed']);self.assertTrue(value['deleted'])
            self.assertEqual(value['lastTick'],125)
            self.assertEqual(value['final']['world']['status'],'ended')
            self.assertEqual([r['tick'] for r in value['checkpoints']],[0,125])
            self.assertIn('ended at tick 125 before requested horizon 600',value['error'])
            self.assertEqual(max(map(int,(directory/'steps.jsonl').read_text().splitlines())),125)

    def test_idle_policy_and_failed_ref_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);repo=self.fixture(root)
            with patch.object(worker,'ROOT',repo),patch.object(worker,'DATA',root/'data'):
                (repo/'src/control/controller.ts').write_text(CONTROLLER.replace('if(!this.automatic||this.sent)return;','return;'))
                directory=worker.run(hours=1/6,working_tree=repo)
                self.assertEqual(json.loads((directory/'result.json').read_text())['actions'],[])
                command=subprocess.run
                def fail_node(args,**kwargs):
                    if args[0]=='node':raise subprocess.CalledProcessError(1,args)
                    return command(args,**kwargs)
                with patch.object(worker.subprocess,'run',side_effect=fail_node):
                    with self.assertRaisesRegex(RuntimeError,'Sandbox run failed'):worker.run(hours=1/6)
                manifests=list((root/'data/experiments/runs').glob('*/run.json'))
                failed=[p.parent for p in manifests if json.loads(p.read_text())['status']=='failed']
                self.assertEqual(len(failed),1);self.assertFalse((failed[0]/'source').exists())
