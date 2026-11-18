import json,pathlib,tempfile,unittest
from unittest.mock import patch
from progress import assess,advance,fingerprint
import progress

class ExperimentTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.runs=self.root/'runs';self.work=self.root/'work'
  (self.work/'src/advisors').mkdir(parents=True);(self.work/'src/advisors/policy.ts').write_text('candidate')
  self.current=fingerprint(self.work)
  for name,fp in [('old','old-policy'),('new',self.current)]:
   directory=self.runs/name;directory.mkdir(parents=True)
   rows=[{'tick':tick,'villages':[]} for tick in [0,300,600]]
   spec={'id':name,'status':'complete','ticks':600,'seed':73430,'snapshotTicks':300,'fingerprint':fp}
   value={'passed':True,'deleted':True,'lastTick':600,'worldId':name,'seed':73430,'rulesVersion':'r1','checkpoints':rows}
   (directory/'run.json').write_text(json.dumps(spec));(directory/'result.json').write_text(json.dumps(value))
   (directory/'snapshots.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
   (directory/'sandbox-events.jsonl').write_text(''.join(json.dumps({'worldId':name,'op':op,'ok':True,'fingerprint':fp,'actionResults':[{'ok':True}]})+'\n' for op in ['create','step','act','delete']))
  (self.root/'evidence').mkdir();(self.root/'evidence/rules.json').write_text('{"version":"r1"}')
  self.task={'id':'question','delivery':'research','stage':'experiment','nextAction':'measure'}
  self.report={'taskId':'question','activate':False,'artifacts':[str(self.runs/n/'result.json') for n in ['old','new']],'verdict':'rejects-change','nextMeasure':'another question'}
 def tearDown(self):self.temp.cleanup()
 def assess(self,gameplay=False):
  with patch.object(progress,'EXPERIMENT_RUNS',self.runs):
   return assess(self.report,{**self.task,'delivery':'gameplay' if gameplay else 'research'},['src/advisors/policy.ts'] if gameplay else [],self.root,self.work,gameplay)
 def test_independent_verified_runs_complete_research(self):
  result=self.assess();self.assertEqual(result['kind'],'research-complete')
  self.assertEqual(advance(self.task,result,self.report)['stage'],'complete')
 def test_single_run_cannot_authorize_activation(self):
  self.report.update(activate=True,verdict='supports-change');self.report['artifacts']=self.report['artifacts'][1:]
  self.assertEqual(self.assess(True)['kind'],'validation-missing')
 def test_exact_candidate_and_current_rules_are_required(self):
  self.report.update(activate=True,verdict='supports-change');self.assertEqual(self.assess(True)['kind'],'implementation')
  (self.work/'src/advisors/policy.ts').write_text('changed');self.assertEqual(self.assess(True)['kind'],'validation-missing')
 def test_mismatched_seed_or_failed_run_is_not_evidence(self):
  self.report.update(activate=True,verdict='supports-change')
  path=self.runs/'old/run.json';spec=json.loads(path.read_text());spec['seed']=1;path.write_text(json.dumps(spec))
  self.assertEqual(self.assess(True)['kind'],'validation-missing')
 def test_rules_change_invalidates_evidence(self):
  self.report.update(activate=True,verdict='supports-change');(self.root/'evidence/rules.json').write_text('{"version":"r2"}')
  self.assertEqual(self.assess(True)['kind'],'validation-missing')
 def test_incomplete_snapshots_are_not_evidence(self):
  self.report.update(activate=True,verdict='supports-change');(self.runs/'new/snapshots.jsonl').write_text('')
  self.assertEqual(self.assess(True)['kind'],'validation-missing')
 def test_research_is_default_but_gameplay_contract_survives(self):
  from progress import select_task
  self.assertEqual(select_task(None,[{'title':'Test walls','nextStep':'measure'}])['delivery'],'research')
  self.assertEqual(select_task(None,[{'title':'Implement','nextStep':'code','delivery':'gameplay'}])['delivery'],'gameplay')
