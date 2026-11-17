import json, pathlib, tempfile, unittest
from unittest.mock import MagicMock, patch

import deploy
from progress import policy_change, runtime_change
from sandbox import fingerprint

class BotRefactorTests(unittest.TestCase):
 def test_fingerprint_covers_nested_backend_and_review_sources(self):
  with tempfile.TemporaryDirectory() as tmp:
   work=pathlib.Path(tmp)
   paths=[]
   for folder in ['src/advisors','src/control','src/bot/plan','src/review']:
    path=work/folder/'nested.ts';path.parent.mkdir(parents=True,exist_ok=True);path.write_text('one')
    paths.append(path)
   for path in paths:
    before=fingerprint(work);path.write_text('two')
    self.assertNotEqual(fingerprint(work),before)

 def test_runtime_and_policy_classification_include_bot_sources(self):
  self.assertTrue(runtime_change(['src/bot/runner/runner.ts']))
  self.assertTrue(runtime_change(['src/review/adapter.ts']))
  self.assertTrue(policy_change(['src/bot/plan/graph.ts']))
  self.assertTrue(policy_change(['src/review/adapter.ts']))

 def prepare_deploy(self, base, saved, compatible_previous):
  root=base/'root';root.mkdir();(root/'node_modules').mkdir();(root/'web/dist').mkdir(parents=True)
  control_dir=base/'private';control_dir.mkdir()
  private=control_dir/'control.json';private.write_text(json.dumps(saved))
  releases=base/'deploy';releases.mkdir();previous=releases/'old';previous.mkdir()
  if compatible_previous:
   manifest=previous/'deploy/store-compat.json';manifest.parent.mkdir();manifest.write_text(json.dumps({'storeVersion':2,'readableStoreVersions':[1,2]}))
  (releases/'current').symlink_to(previous)
  fake_tar=MagicMock();fake_tar.__enter__.return_value=fake_tar
  return root,control_dir,releases,previous,private,fake_tar

 def test_failed_release_stops_when_previous_cannot_read_current_store(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp)
   root,control_dir,releases,previous,private,fake_tar=self.prepare_deploy(base,{'storeVersion':2,'settings':{},'automatic':False},False)
   with patch.object(deploy,'ROOT',root),patch.object(deploy,'DEPLOY',releases),patch.object(deploy,'CONTROL',control_dir),patch.object(deploy,'command') as command,patch.object(deploy.subprocess,'run'),patch.object(deploy.tarfile,'open',return_value=fake_tar),patch.object(deploy.time,'sleep'),patch.object(deploy,'control',side_effect=[{'automatic':False}]+[RuntimeError('bad release')]*4):
    with self.assertRaisesRegex(RuntimeError,'recovery required'):deploy.activate(root,'testcommit')
   command.assert_any_call(['systemctl','stop','norm-steward-control'])
   self.assertEqual([call.args[0] for call in command.call_args_list].count(['systemctl','start','norm-steward-control']),1)
   status=json.loads((releases/'deployment.json').read_text())
   self.assertEqual(status['status'],'recovery-required');self.assertEqual(status['storeVersion'],2)
   self.assertEqual((releases/'current').resolve(),releases/'releases'/'testcommit')

 def test_failed_release_rolls_back_when_previous_reads_current_store(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp)
   root,control_dir,releases,previous,private,fake_tar=self.prepare_deploy(base,{'storeVersion':2,'settings':{},'automatic':False},True)
   with patch.object(deploy,'ROOT',root),patch.object(deploy,'DEPLOY',releases),patch.object(deploy,'CONTROL',control_dir),patch.object(deploy,'command') as command,patch.object(deploy.subprocess,'run'),patch.object(deploy.tarfile,'open',return_value=fake_tar),patch.object(deploy.time,'sleep'),patch.object(deploy,'control',side_effect=[{'automatic':False}]+[RuntimeError('bad release')]*4):
    with self.assertRaisesRegex(RuntimeError,'previous release restored'):deploy.activate(root,'testcommit')
   self.assertEqual((releases/'current').resolve(),previous)
   self.assertEqual(json.loads((releases/'deployment.json').read_text())['status'],'rolled-back')

if __name__=='__main__':unittest.main()
