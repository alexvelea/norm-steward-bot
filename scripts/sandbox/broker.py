"""Managed owner-only sandbox broker. Agents never need to read credentials."""
import hashlib, json, os, pathlib, subprocess

class SandboxError(RuntimeError): pass

def fingerprint(work):
    digest=hashlib.sha256()
    digest.update(b'norm-steward-source-fingerprint-v2\0')
    for folder in ['src/advisors','src/control','src/bot','src/review']:
        for path in sorted((pathlib.Path(work)/folder).rglob('*.ts')):
            digest.update(str(path.relative_to(work)).encode());digest.update(b'\0');digest.update(path.read_bytes())
    return digest.hexdigest()

class Broker:
    """Compatibility for review recovery; normal runs use one persistent Node broker."""
    def __init__(self,directory,work):
        self.directory=pathlib.Path(directory);self.work=pathlib.Path(work)
    def call(self,request):
        registry=self.directory/'sandboxes.json'
        if request.get('op')=='cleanup' and (not registry.exists() or not any(not v.get('deleted') and (request.get('kept') or not v.get('kept')) for v in json.loads(registry.read_text()).get('worlds',{}).values())):return []
        tools=pathlib.Path(os.environ.get('STEWARD_REVIEW_TOOLS',pathlib.Path(__file__).resolve().parents[2]))
        env={k:os.environ[k] for k in ['PATH','HOME','LANG','TMPDIR','STEWARD_CONTROL_DIR','STEWARD_REVIEW_DIR'] if k in os.environ}
        env['STEWARD_REVIEW_RUN']=str(self.directory.resolve())
        result=subprocess.run(['node','--import','tsx',str(tools/'scripts/sandbox/broker-cli.mts')],cwd=self.work,env=env,input=json.dumps(request)+'\n',capture_output=True,text=True,timeout=180)
        if result.returncode:raise SandboxError('Sandbox recovery broker failed; inspect sandbox-events.jsonl')
        value=json.loads(result.stdout.splitlines()[0])
        if not value['ok']:raise SandboxError(value['error'])
        return value['result']
