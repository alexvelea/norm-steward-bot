"""Read installed Codex app-server's actual quota snapshots without inference or credentials."""
import json, os, selectors, subprocess, time

def read_usage(timeout=18):
    process = subprocess.Popen(["codex", "app-server", "--listen", "stdio://"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    def send(value):
        process.stdin.write(json.dumps(value)+"\n"); process.stdin.flush()
    try:
        send({"id":1,"method":"initialize","params":{"clientInfo":{"name":"steward-review","version":"1.0"},"capabilities":None}})
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            if not selector.select(max(0,deadline-time.monotonic())): break
            line=process.stdout.readline()
            if not line: break
            item=json.loads(line)
            if item.get("id")==1:
                if "error" in item: return {"available":False,"error":"Codex initialization failed"}
                send({"method":"initialized","params":{}})
                send({"id":2,"method":"account/rateLimits/read","params":None})
            if item.get("id")==2:
                if "error" in item: return {"available":False,"error":"Usage API unavailable"}
                result=item["result"]
                # Account IDs, credit balances, upsell links and auth material are not needed.
                snapshots=result.get("rateLimitsByLimitId") or {"default":result.get("rateLimits",{})}
                return {"available":True,"observedAt":int(time.time()),"ordinaryUsageAllowed":result.get("ordinaryUsageAllowed"),"limits":{key:{k:v.get(k) for k in ("limitId","limitName","normalModelSlug","primary","secondary","spendControlReached","rateLimitReachedType")} for key,v in snapshots.items()}}
        return {"available":False,"error":"Usage API timed out"}
    except (OSError,ValueError,KeyError):
        return {"available":False,"error":"Usage API could not be read"}
    finally:
        selector.close()
        try: os.killpg(process.pid,15); process.wait(timeout=3)
        except (ProcessLookupError,subprocess.TimeoutExpired):
            try: os.killpg(process.pid,9)
            except ProcessLookupError: pass
        process.stdin.close();process.stdout.close()

def budget_pause(usage, now):
    """Use explicit denial/exhaustion; a reset timestamp is a retry hint, not proof of recovery."""
    if not usage.get("available"): return None
    windows=[w for limit in usage.get("limits",{}).values() for w in (limit.get("primary"),limit.get("secondary")) if w and w.get("usedPercent",0)>=100]
    denied=usage.get("ordinaryUsageAllowed") is False or any(limit.get("spendControlReached") is True or limit.get("rateLimitReachedType") for limit in usage.get("limits",{}).values())
    if windows or denied:
        resets=[w["resetsAt"]+60 for w in windows if isinstance(w.get("resetsAt"),(int,float)) and w["resetsAt"]>now]
        return max(resets) if resets else now+3600
    return None

if __name__=="__main__": print(json.dumps(read_usage(),indent=2))
