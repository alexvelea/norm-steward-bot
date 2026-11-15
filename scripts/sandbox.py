#!/usr/bin/env python3
"""Read one JSON request on stdin. Registry restricts every operation to sandboxes this run owns."""
import json,os,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'review'))
from sandbox import Broker
os.umask(0o077)
try:
    run=pathlib.Path(os.environ['STEWARD_REVIEW_RUN']).resolve()
    base=pathlib.Path(os.environ.get('STEWARD_REVIEW_DIR','/var/lib/norm-steward-review')).resolve()
    if not run.is_relative_to(base) or run==base:raise ValueError('Run must be a private review subdirectory')
    result=Broker(run,pathlib.Path.cwd()).call(json.load(sys.stdin))
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({'error':str(error)[:500]}));sys.exit(1)
