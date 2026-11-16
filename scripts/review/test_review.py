import importlib.util, json, os, pathlib, sys, tempfile, unittest
from unittest.mock import patch
BASE=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('review_runner',BASE/'review.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
from usage import budget_pause

class ReviewTests(unittest.TestCase):
 def test_actual_exhaustion_uses_backend_reset_not_assumed_window(self):
  self.assertEqual(budget_pause({'available':True,'limits':{'codex':{'primary':{'usedPercent':100,'resetsAt':1350}}}},1000),1410)
  self.assertIsNone(budget_pause({'available':False},1000))
  self.assertIsNone(budget_pause({'available':True,'ordinaryUsageAllowed':True,'limits':{'codex':{'primary':{'usedPercent':22,'resetsAt':1350}}}},1000))
  self.assertEqual(budget_pause({'available':True,'ordinaryUsageAllowed':False},1000),4600)
 def test_both_exhausted_windows_must_recover(self):
  self.assertEqual(budget_pause({'available':True,'limits':{'a':{'primary':{'usedPercent':100,'resetsAt':1200},'secondary':{'usedPercent':100,'resetsAt':1900}}}},1000),1960)
 def test_protected_changes_do_not_auto_activate(self):
  self.assertTrue(runner.allowed_changes(['src/advisors/hall.ts','test/hall.test.ts']))
  for path in ['AGENTS.md','src/rules/config.ts','src/shared/api.ts','package-lock.json','scripts/review.py','scripts/experiments.py','scripts/experiment-policy.mts','deploy/service','../outside']:
   self.assertFalse(runner.allowed_changes([path]))
 def test_unknown_final_result_never_activates(self):
  self.assertFalse(runner.validate_report({'summary':'done'}));self.assertFalse(runner.validate_report(None))
 def test_lock_prevents_overlapping_manual_review(self):
  import fcntl
  with tempfile.TemporaryDirectory() as tmp,patch.object(runner,'DATA',pathlib.Path(tmp)):
   with (pathlib.Path(tmp)/'review.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    self.assertEqual(runner.review(),'overlap-skipped')
 def test_pause_does_not_invoke_codex_or_touch_gameplay(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(runner,'DATA',pathlib.Path(tmp)),patch.object(runner,'run_command') as cmd:
   (pathlib.Path(tmp)/'paused').write_text('paused')
   self.assertEqual(runner.review(),'paused');cmd.assert_not_called()
 def test_agent_output_and_usage_are_recorded(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(runner,'DATA',pathlib.Path(tmp)),patch.object(runner,'WORK',pathlib.Path(tmp)):
   cmd=[sys.executable,'-c','import sys,json;sys.stdin.read();print(json.dumps({"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}))']
   status,usage=runner.run_agent(cmd,'hello',pathlib.Path(tmp),timeout=2)
   self.assertEqual(status,'completed');self.assertEqual(usage['input_tokens'],12)
 def test_agent_time_limit_stops_process_without_deleting_progress(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(runner,'DATA',pathlib.Path(tmp)),patch.object(runner,'WORK',pathlib.Path(tmp)):
   progress=pathlib.Path(tmp)/'progress.txt';progress.write_text('keep')
   status,_=runner.run_agent([sys.executable,'-c','import time;time.sleep(10)'],'',pathlib.Path(tmp),timeout=.1)
   self.assertEqual(status,'timeout');self.assertEqual(progress.read_text(),'keep')
 def test_automatic_state_is_not_in_review_pause_file(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(runner,'DATA',pathlib.Path(tmp)):
   runner.update(status='budget-paused',retryAt=1999)
   self.assertNotIn('automatic',json.loads((pathlib.Path(tmp)/'state.json').read_text()))

 def test_failed_release_restores_previous_and_preserves_gameplay_pause(self):
  import deploy
  from unittest.mock import MagicMock
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp);root=base/'root';root.mkdir();(root/'node_modules').mkdir();(root/'web/dist').mkdir(parents=True)
   control=base/'private';control.mkdir();(control/'control.json').write_text(json.dumps({'settings':{},'automatic':False}))
   releases=base/'deploy';releases.mkdir();previous=releases/'old';previous.mkdir();(releases/'current').symlink_to(previous)
   fake_tar=MagicMock();fake_tar.__enter__.return_value=fake_tar
   with patch.object(deploy,'ROOT',root),patch.object(deploy,'DEPLOY',releases),patch.object(deploy,'CONTROL',control),patch.object(deploy,'command') as command,patch.object(deploy.subprocess,'run'),patch.object(deploy.tarfile,'open',return_value=fake_tar),patch.object(deploy.time,'sleep'),patch.object(deploy,'control',side_effect=[{'automatic':False}]+[RuntimeError('bad release')]*4):
    with self.assertRaisesRegex(RuntimeError,'previous release restored'):deploy.activate(root,'testcommit')
   self.assertEqual((releases/'current').resolve(),previous)
   self.assertFalse(json.loads((control/'control.json').read_text())['automatic'])
   self.assertEqual(json.loads((releases/'deployment.json').read_text())['status'],'rolled-back')


class ProgressTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=pathlib.Path(self.temp.name);self.work=self.base/'work';self.work.mkdir();self.run=self.base/'run';self.run.mkdir()
  self.task={'id':'defence','title':'Defence','stage':'implement','attempts':0,'noProgressStreak':0,'instrumentationRuns':1,'nextAction':'run experiment'}
  self.report={'taskId':'defence','activate':False,'artifacts':[],'verdict':'not-applicable','nextMeasure':'implement','blocker':None}
 def tearDown(self):self.temp.cleanup()
 def test_pinned_task_survives_backlog_reshuffle(self):
  from progress import select_task
  self.assertEqual(select_task(self.task,[{'title':'Avoid task','nextStep':'report'}]),self.task)
 def test_repeated_reporting_is_not_gameplay_progress(self):
  from progress import assess,advance
  result=assess(self.report,self.task,['src/review/more-report.ts'],self.run,self.work,True)
  self.assertTrue(result['needsRetry']);self.assertFalse(result['credit']);self.assertEqual(advance(self.task,result,self.report)['noProgressStreak'],1)
 def test_missing_evidence_without_attempt_is_not_external_blocker(self):
  from progress import assess
  self.report['blocker']={'kind':'missing evidence','message':'No sandbox supplied','attemptLog':''}
  self.assertTrue(assess(self.report,self.task,[],self.run,self.work,False)['needsRetry'])
 def test_activation_requires_real_receipts_not_just_claimed_artifact(self):
  from progress import assess
  self.report['activate']=True;(self.run/'fake.json').write_text('{"passed":true}');self.report['artifacts']=[str(self.run/'fake.json')]
  self.assertEqual(assess(self.report,self.task,['src/advisors/army.ts'],self.run,self.work,True)['kind'],'validation-missing')
 def test_actual_managed_comparison_is_credited_and_code_changes_invalidate_it(self):
  from progress import assess
  from sandbox import fingerprint
  (self.work/'src/advisors').mkdir(parents=True);policy=self.work/'src/advisors/policy.ts';policy.write_text('old')
  receipts=[]
  for world in ['one','two']:
   for op in ['create','step','act']:receipts.append({'op':op,'worldId':world,'ok':True,'fingerprint':fingerprint(self.work),'actionResults':[{'ok':True}]})
  (self.run/'sandbox-events.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in receipts))
  artifact=self.run/'comparison.json';artifact.write_text(json.dumps({'passed':True,'results':[{'worldId':'one','policy':'baseline'},{'worldId':'two','policy':'candidate'}]}));self.report['artifacts']=[str(artifact)];self.report['activate']=True;self.report['verdict']='supports-change'
  self.assertFalse(assess(self.report,self.task,['src/advisors/policy.ts'],self.run,self.work,True)['needsRetry'])
  self.report['verdict']='rejects-change'
  self.assertTrue(assess(self.report,self.task,['src/advisors/policy.ts'],self.run,self.work,True)['needsRetry'])
  self.report['verdict']='supports-change'
  artifact.write_text(json.dumps({'passed':False,'results':[{'worldId':'one','policy':'baseline'},{'worldId':'two','policy':'candidate'}]}))
  self.assertTrue(assess(self.report,self.task,['src/advisors/policy.ts'],self.run,self.work,True)['needsRetry'])
  artifact.write_text(json.dumps({'passed':True,'results':[{'worldId':'one','policy':'baseline'},{'worldId':'two','policy':'candidate'}]}))
  policy.write_text('changed after experiment')
  self.assertEqual(assess(self.report,self.task,['src/advisors/policy.ts'],self.run,self.work,True)['kind'],'validation-missing')
 def test_recovered_rate_limit_is_not_a_real_blocker(self):
  from progress import assess
  (self.run/'sandbox-events.jsonl').write_text(json.dumps({'op':'rate-limit','ok':False,'retryAfterSeconds':1})+'\n')
  self.report['blocker']={'kind':'rate-limit','message':'A past retry','attemptLog':'sandbox-events.jsonl'}
  self.assertTrue(assess(self.report,self.task,[],self.run,self.work,False)['needsRetry'])
 def test_only_implementation_ready_plus_successful_delivery_closes_work(self):
  from progress import delivered
  task={**self.task,'requiredPaths':['src/advisors/army.ts']};paths=['src/advisors/army.ts'];report={'implementationComplete':True}
  self.assertEqual(delivered(task,report,paths,{'commit':'ok','status':'healthy'})['stage'],'complete')
  self.assertNotEqual(delivered(task,report,[],{'commit':'ok','status':'healthy'})['stage'],'complete')
  self.assertNotEqual(delivered(task,report,paths,{'commit':'bad','status':'rolled-back'})['stage'],'complete')
  self.assertNotEqual(delivered(task,{'implementationComplete':False},paths,{'commit':'partial','status':'healthy'})['stage'],'complete')
 def test_old_pending_runtime_diff_does_not_turn_new_reporting_into_progress(self):
  from progress import assess
  result=assess(self.report,self.task,['src/advisors/pending.ts','src/review/report.ts'],self.run,self.work,True,['src/review/report.ts'])
  self.assertTrue(result['needsRetry'])

class BrokerTests(unittest.TestCase):
 def test_broker_refuses_unregistered_live_or_foreign_world(self):
  from sandbox import Broker,SandboxError
  with tempfile.TemporaryDirectory() as tmp:
   broker=Broker(pathlib.Path(tmp)/'run',pathlib.Path(tmp),api=lambda *a,**k:None)
   for op in ['act','step','delete','read','join']:
    with self.assertRaisesRegex(SandboxError,'not created'):broker.call({'op':op,'world':'blitz-1'})
 def test_broker_verifies_creator_and_stable_action_payload(self):
  from sandbox import Broker,SandboxError
  from unittest.mock import Mock
  with tempfile.TemporaryDirectory() as tmp:
   def api(path,body=None,method=None):
    if path=='/me':return {'account':{'id':'owner'}}
    if path=='/sandboxes':return {'id':'sb-one','kind':'sandbox','ownerId':'owner'}
    if path=='/worlds/sb-one':return {'id':'sb-one','kind':'sandbox','ownerId':'owner','tick':0}
    return {'results':[{'ok':True}]}
   broker=Broker(pathlib.Path(tmp)/'run',pathlib.Path(tmp),api=api);broker.call({'op':'create'})
   request={'op':'act','world':'sb-one','requestId':'stable','actions':[{'type':'build','building':'farm','village':'v'}]};broker.call(request)
   request['actions'][0]['building']='hall'
   with self.assertRaisesRegex(SandboxError,'different actions'):broker.call(request)


class ReviewFlowTests(unittest.TestCase):
 def run_cycle(self,implement_on_retry):
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp);root=base/'root';data=base/'data';work=data/'worktree';work.mkdir(parents=True);(work/'node_modules').mkdir();(root/'scripts/review').mkdir(parents=True)
   (root/'scripts/review/prompt.md').write_text('Execute the pinned task')
   (data/'backlog.json').write_text(json.dumps([{'id':'defence','title':'Defence','priority':1,'nextStep':'Implement prototype'}]))
   calls=[]
   def model(args,prompt,run,timeout):
    calls.append(prompt)
    if implement_on_retry and len(calls)==2:
     file=work/'src/advisors/prototype.ts';file.parent.mkdir(parents=True);file.write_text('export const prototype = true;')
    report={'taskId':'defence','summary':'Prototype' if len(calls)==2 else 'Evidence absent','evidence':[],'expectedEffect':'Test later','measuredOutcome':'No live effect','nextMeasure':'Sandbox compare prototype','activate':False,'backlog':[{'id':'defence','title':'Defence','priority':1,'nextStep':'Implement prototype'}],'outcome':'implementation' if implement_on_retry and len(calls)==2 else 'no-change','artifacts':[],'verdict':'not-applicable','taskComplete':False,'blocker':None}
    (run/'result.json').write_text(json.dumps(report));return 'completed',{'input_tokens':10}
   def command(args,**kwargs):
    if args[:3]==['codex','login','status']:return 'Logged in using ChatGPT'
    if args[:3]==['git','diff','--name-only']:return 'src/advisors/prototype.ts' if (work/'src/advisors/prototype.ts').exists() else ''
    return ''
   with patch.object(runner,'ROOT',root),patch.object(runner,'DATA',data),patch.object(runner,'WORK',work),patch.object(runner,'read_usage',return_value={'available':True,'ordinaryUsageAllowed':True}),patch.object(runner,'collect'),patch.object(runner,'run_agent',side_effect=model),patch.object(runner,'run_command',side_effect=command),patch.object(runner,'activate') as deploy:
    result=runner.review();deploy.assert_not_called()
   state=json.loads((data/'state.json').read_text());task=json.loads((data/'work.json').read_text())
   self.assertEqual(len(calls),2);self.assertIn('CORRECTIVE RETRY',calls[1]);self.assertEqual(task['id'],'defence')
   self.assertEqual(state['activeTask']['attempts'],2)
   if implement_on_retry:self.assertEqual(result,'in-progress');self.assertEqual(task['lastOutcome'],'implementation');self.assertTrue((work/'src/advisors/prototype.ts').exists())
   else:self.assertEqual(result,'stalled');self.assertEqual(state['status'],'stalled');self.assertEqual(task['noProgressStreak'],2)
 def test_corrective_retry_advances_saved_implementation_without_activating_incomplete_code(self):self.run_cycle(True)
 def test_repeated_deferral_is_visible_stalled_not_reported_as_success(self):self.run_cycle(False)

if __name__=='__main__':unittest.main()
