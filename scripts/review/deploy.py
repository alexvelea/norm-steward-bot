"""Verified immutable releases; a failed health check switches back to the prior release."""
import json, os, pathlib, shutil, subprocess, tarfile, tempfile, time
from evidence import CONTROL, control

ROOT=pathlib.Path('/root/norm-steward-bot')
DEPLOY=pathlib.Path('/var/lib/norm-steward-deploy')
def command(args,cwd=ROOT,timeout=180):
    return subprocess.run(args,cwd=cwd,check=True,timeout=timeout,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def atomic(path,data):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2));os.chmod(temp,0o600)
    with temp.open('r') as f:os.fsync(f.fileno())
    os.replace(temp,path)
    descriptor=os.open(path.parent,os.O_DIRECTORY)
    try:os.fsync(descriptor)
    finally:os.close(descriptor)
def switch(target):
    temp=DEPLOY/'next';temp.unlink(missing_ok=True);temp.symlink_to(target);os.replace(temp,DEPLOY/'current')
def activate(worktree,commit):
    DEPLOY.mkdir(parents=True,exist_ok=True,mode=0o700)
    release=DEPLOY/'releases'/commit;release.mkdir(parents=True,exist_ok=True,mode=0o700)
    # git archive excludes runtime/private files and includes exactly the verified commit.
    with tempfile.TemporaryFile() as archive:
        subprocess.run(['git','archive',commit],cwd=worktree,stdout=archive,check=True);archive.seek(0)
        with tarfile.open(fileobj=archive) as tar:tar.extractall(release,filter='data')
    (release/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True) if not (release/'node_modules').exists() else None
    shutil.copytree(pathlib.Path(worktree)/'web/dist',release/'web/dist',dirs_exist_ok=True)
    previous=(DEPLOY/'current').resolve() if (DEPLOY/'current').exists() else ROOT
    before=control();expected=before['automatic']
    command(['systemctl','stop','norm-steward-control'])
    private=CONTROL/'control.json';saved=json.loads(private.read_text())
    # Migration from the old non-persistent executor; later deployments trust its durable preference.
    if not isinstance(saved.get('automatic'),bool):saved['automatic']=expected;atomic(private,saved)
    expected=saved['automatic']
    switch(release)
    try:
        command(['systemctl','start','norm-steward-control'])
        error=None
        for _ in range(4):
            time.sleep(3)
            try:
                view=control()
                if view['connection']=='connected' and view['automatic']==expected:
                    atomic(DEPLOY/'deployment.json',{'commit':commit,'previous':str(previous),'release':str(release),'activatedAt':time.time(),'automatic':expected,'status':'healthy'})
                    return {'commit':commit,'status':'healthy','automatic':expected}
                error=RuntimeError('Game connection or execution preference did not match')
            except Exception as failure:error=failure
        raise RuntimeError('Release health check failed') from error
    except Exception:
        command(['systemctl','stop','norm-steward-control']);switch(previous)
        command(['systemctl','start','norm-steward-control'])
        atomic(DEPLOY/'deployment.json',{'commit':commit,'status':'rolled-back','previous':str(previous),'at':time.time()})
        raise RuntimeError('New release failed health check; previous release restored')
