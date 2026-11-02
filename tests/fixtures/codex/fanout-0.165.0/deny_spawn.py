"""PreToolUse hook: record the body; deny any subagent spawn the way HiveTTY's fence replies."""
import json, sys

out = sys.argv[1]
body = sys.stdin.read()
with open(out, 'a') as f:
    f.write(body.strip() + '\n')
o = json.loads(body)
name = o.get('tool_name') or o.get('toolName') or ''
if 'spawn_agent' in name or name == 'task':
    reason = 'HiveTTY fence: subagent dispatch is not allowed in this run.'
    if 'toolName' in o:  # Copilot's preToolUse shape
        print(json.dumps({'permissionDecision': 'deny', 'permissionDecisionReason': reason}))
    else:
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse',
                                                 'permissionDecision': 'deny',
                                                 'permissionDecisionReason': reason}}))
else:
    print('{}')
