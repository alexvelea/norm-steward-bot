"""Private, read-only gameplay evidence. Never includes game keys or session cookies."""
import http.cookiejar, json, os, pathlib, urllib.request, urllib.parse

CONTROL=pathlib.Path(os.environ.get("STEWARD_CONTROL_DIR","/var/lib/norm-steward-bot"))
def settings(): return json.loads((CONTROL/"control.json").read_text())["settings"]
def game(path,body=None,method=None):
    s=settings()
    headers={"Authorization":"Bearer "+s["apiKey"],"Content-Type":"application/json"}
    if body is None and method is None: headers["X-Steward-Client"]="dashboard"
    request=urllib.request.Request(s["serverUrl"]+"/api/v1"+path,None if body is None else json.dumps(body).encode(),headers,method=method)
    with urllib.request.urlopen(request,timeout=25) as response:
        raw=response.read();return json.loads(raw) if raw else None

def control(path="/control/state",body=None,method=None):
    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    base=os.environ.get("STEWARD_LOCAL_URL","http://127.0.0.1:8788")
    opener.open(base+"/access/login",urllib.parse.urlencode({"token":(CONTROL/"access-token.txt").read_text().strip()}).encode(),timeout=15).read()
    opener.open(urllib.request.Request(base+"/control/session",json.dumps({"apiKey":settings()["apiKey"]}).encode(),{"Content-Type":"application/json"}),timeout=15).read()
    with opener.open(urllib.request.Request(base+path,None if body is None else json.dumps(body).encode(),{"Content-Type":"application/json"},method=method),timeout=20) as response:return json.load(response)

def collect(directory):
    directory=pathlib.Path(directory);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    s=settings();prefix="/worlds/"+urllib.parse.quote(s["worldId"],safe="")
    results={}
    for name,path in {"state":prefix+"/state","rules":prefix+"/rules","history":prefix+"/history","reports":prefix+"/reports?limit=50","activity":prefix+"/activity?after=0&limit=1000"}.items():
        try: results[name]=game(path)
        except Exception as error: results[name]={"collectionError":type(error).__name__}
    try: results["control"]=control()
    except Exception as error: results["control"]={"collectionError":type(error).__name__}
    for name,data in results.items():(directory/(name+".json")).write_text(json.dumps(data,indent=2))
    state=results["state"]; activity=results["activity"].get("entries",[])
    summary={"world":state.get("world"),"villages":[{"name":v["name"],"buildings":v["buildings"],"resources":v["resources"],"storage":v["storage"],"population":v["population"],"production":v["production"],"queue":v["buildQueue"],"units":v["units"],"training":v["training"]} for v in state.get("villages",[])],"threats":state.get("commands",{}).get("incoming",[]),"activityEntries":len(activity),"actionFailures":[a for e in activity for a in e.get("actions",[]) if not a.get("ok")],"automatic":results["control"].get("automatic"),"collectionErrors":{k:v["collectionError"] for k,v in results.items() if isinstance(v,dict) and "collectionError" in v}}
    (directory/"summary.json").write_text(json.dumps(summary,indent=2));return summary
