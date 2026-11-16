import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
from sandbox import fingerprint
from progress import assess,advance
import progress
spec=importlib.util.spec_from_file_location('experiment_worker',pathlib.Path(__file__).resolve().parents[1]/'experiments.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class ExperimentTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.jobs=self.root/'jobs';self.job=self.jobs/'one';self.job.mkdir(parents=True)
  self.spec={'id':'one','status':'complete','ticks':600,'seed':73430}
  for policy in ['baseline','candidate']:
   case=self.job/policy;(case/'source/src/advisors').mkdir(parents=True);(case/'source/src/advisors/policy.ts').write_text(policy)
   fp=fingerprint(case/'source');self.spec[policy+'Fingerprint']=fp
   (case/'result.json').write_text(json.dumps({'passed':True,'deleted':True,'lastTick':600,'worldId':policy,'seed':73430,'rulesVersion':'r1'}))
   entries=[{'worldId':policy,'op':op,'ok':True,'fingerprint':fp,'actionResults':[{'ok':True}]} for op in ['create','step','act','delete']]
   (case/'sandbox-events.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in entries))
  (self.job/'job.json').write_text(json.dumps(self.spec));(self.job/'comparison.json').write_text(json.dumps({'passed':True,'cases':[{},{}]}))
  self.task={'id':'question','delivery':'research','stage':'experiment','nextAction':'compare'}
  self.report={'taskId':'question','activate':False,'artifacts':[str(self.job/'comparison.json')],'verdict':'rejects-change','nextMeasure':'another question'}
 def tearDown(self):self.temp.cleanup()
 def test_negative_verified_experiment_completes_research_without_code(self):
  with patch.object(progress,'EXPERIMENT_JOBS',self.jobs):r=assess(self.report,self.task,[],self.root,self.root,False)
  self.assertEqual(r['kind'],'research-complete');self.assertFalse(r['needsRetry'])
  task=advance(self.task,r,self.report);self.assertEqual(task['stage'],'complete')
  with patch.object(progress,'EXPERIMENT_JOBS',self.jobs):self.assertFalse(assess(self.report,task,[],self.root,self.root,False)['credit'])
 def test_candidate_edits_invalidate_worker_evidence(self):
  (self.job/'candidate/source/src/advisors/policy.ts').write_text('changed')
  with patch.object(progress,'EXPERIMENT_JOBS',self.jobs):self.assertFalse(assess(self.report,self.task,[],self.root,self.root,False)['credit'])
 def test_worker_evidence_cannot_activate_a_different_policy(self):
  self.report.update(activate=True,verdict='supports-change')
  with patch.object(progress,'EXPERIMENT_JOBS',self.jobs):r=assess(self.report,self.task,['src/advisors/policy.ts'],self.root,self.root,True)
  self.assertEqual(r['kind'],'validation-missing')
 def test_pending_job_is_waiting_not_a_claimed_success(self):
  self.spec['status']='queued';(self.job/'job.json').write_text(json.dumps(self.spec))
  with patch.object(progress,'EXPERIMENT_JOBS',self.jobs):r=assess(self.report,self.task,[],self.root,self.root,False)
  self.assertEqual(r['kind'],'experiment-waiting');self.assertNotEqual(advance(self.task,r,self.report)['stage'],'complete')
 def test_case_requires_exact_endpoint_and_owned_successful_actions(self):
  case=self.job/'baseline';self.assertTrue(worker.valid_case(case,self.spec,'baseline'))
  d=json.loads((case/'result.json').read_text());d['lastTick']=599;(case/'result.json').write_text(json.dumps(d))
  self.assertFalse(worker.valid_case(case,self.spec,'baseline'))
 def test_worker_overlap_and_pause_do_not_start_subprocesses(self):
  import fcntl
  with patch.object(worker,'DATA',self.root),patch.object(worker,'JOBS',self.jobs),patch.object(worker.subprocess,'run') as run:
   with (self.root/'review.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);self.assertEqual(worker.work_once(),'busy')
   (self.root/'paused').write_text('pause');self.assertEqual(worker.work_once(),'paused');run.assert_not_called()
 def test_research_is_default_but_explicit_gameplay_contract_survives(self):
  from progress import select_task
  self.assertEqual(select_task(None,[{'title':'Test walls','nextStep':'compare'}])['delivery'],'research')
  self.assertEqual(select_task(None,[{'title':'Implement','nextStep':'code','delivery':'gameplay'}])['delivery'],'gameplay')

 def test_completed_worker_can_validate_exact_candidate_without_repeating_long_test(self):
  self.report.update(activate=True,verdict='supports-change');work=self.job/'candidate/source'
  (self.root/'evidence').mkdir();(self.root/'evidence/rules.json').write_text('{"version":"r1"}')
  with patch.object(progress,'EXPERIMENT_JOBS',self.jobs):r=assess(self.report,{**self.task,'delivery':'gameplay'},['src/advisors/policy.ts'],self.root,work,True)
  self.assertEqual(r['kind'],'implementation');self.assertFalse(r['needsRetry'])
 def test_submission_snapshots_code_and_reuses_duplicate_job(self):
  import subprocess
  repo=self.root/'repo';repo.mkdir();(repo/'src/advisors').mkdir(parents=True);(repo/'src/advisors/policy.ts').write_text('baseline')
  subprocess.run(['git','init','-q',str(repo)],check=True)
  subprocess.run(['git','add','src'],cwd=repo,check=True)
  subprocess.run(['git','-c','user.name=Test','-c','user.email=test@localhost','commit','-qm','baseline'],cwd=repo,check=True)
  (repo/'src/advisors/policy.ts').write_text('candidate')
  with patch.object(worker,'ROOT',repo),patch.object(worker,'JOBS',self.root/'queue'):
   job=worker.submit('HEAD',repo,'delay walls','army and production',600)
   self.assertEqual(worker.submit('HEAD',repo,'delay walls','army and production',600),job)
   self.assertEqual((job/'baseline/source/src/advisors/policy.ts').read_text(),'baseline')
   self.assertEqual((job/'candidate/source/src/advisors/policy.ts').read_text(),'candidate')
   (repo/'src/advisors/policy.ts').write_text('next change')
   self.assertEqual((job/'candidate/source/src/advisors/policy.ts').read_text(),'candidate')
   self.assertNotEqual(worker.submit('HEAD',repo,'another variant','army and production',600),job)

 def test_upstream_rule_change_invalidates_old_worker_activation_evidence(self):
  self.report.update(activate=True,verdict='supports-change');work=self.job/'candidate/source'
  (self.root/'evidence').mkdir();(self.root/'evidence/rules.json').write_text('{"version":"r2"}')
  with patch.object(progress,'EXPERIMENT_JOBS',self.jobs):r=assess(self.report,{**self.task,'delivery':'gameplay'},['src/advisors/policy.ts'],self.root,work,True)
  self.assertEqual(r['kind'],'validation-missing')
