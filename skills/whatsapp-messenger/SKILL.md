---
name: whatsapp-messenger
description: Send WhatsApp messages to Omer, read WhatsApp conversations, create polls, send reactions, and communicate via WAHA REST API. Use when the user asks to "message me on WhatsApp", "send a WhatsApp message", "notify me on WhatsApp", "read WhatsApp messages", "check WhatsApp", "create a WhatsApp poll", "send WhatsApp reaction", or when you need to communicate with Omer outside of the terminal.
version: 1.0.0
---

# WhatsApp Messenger Skill

Send and read WhatsApp messages through the WAHA REST API on hpg6 server.

## Connection Details

| Setting | Value |
|---------|-------|
| **SSH** | `ssh omer@100.114.126.43` (key auth) |
| **WAHA API** | `http://127.0.0.1:3004` (on hpg6) |
| **API Key Header** | `X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=` |
| **Session** | `3cf11776_omer` |

## Omer's Contact Details

| Target | Chat ID |
|--------|---------|
| **Omer DM** | `972544329000@c.us` |
| **Sammie Test Group** | `120363421825201386@g.us` |

## Operations

All commands run via SSH to hpg6 then call the WAHA REST API.

### Send Text Message

```bash
ssh omer@100.114.126.43 'python3 -c "
import json, urllib.request
data = json.dumps({
    \"chatId\": \"CHAT_ID\",
    \"text\": \"YOUR_MESSAGE\",
    \"session\": \"3cf11776_omer\"
}).encode()
req = urllib.request.Request(\"http://127.0.0.1:3004/api/sendText\", data=data, headers={\"Content-Type\": \"application/json\", \"X-Api-Key\": \"XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=\"})
print(urllib.request.urlopen(req).read().decode()[:200])
"'
```

Replace `CHAT_ID` with `972544329000@c.us` (Omer DM) or a group JID.

### Read Recent Messages

```bash
ssh omer@100.114.126.43 'curl -s "http://127.0.0.1:3004/api/messages?chatId=CHAT_ID&limit=10&session=3cf11776_omer" -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" | python3 -c "
import json,sys
for m in json.load(sys.stdin):
    body = m.get(\"body\",\"\") or m.get(\"message\",{}).get(\"extendedTextMessage\",{}).get(\"text\",\"\") or m.get(\"message\",{}).get(\"conversation\",\"\")
    who = \"ME\" if m.get(\"key\",{}).get(\"fromMe\",False) else \"THEM\"
    if body: print(f\"{who}: {body[:500]}\n\")
"'
```

### Create Poll

```bash
ssh omer@100.114.126.43 'curl -s -X POST "http://127.0.0.1:3004/api/sendPoll" -H "Content-Type: application/json" -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" -d "{\"session\": \"3cf11776_omer\", \"chatId\": \"CHAT_ID\", \"poll\": {\"name\": \"QUESTION\", \"options\": [\"Option1\", \"Option2\", \"Option3\"], \"multipleAnswers\": false}}"'
```

### Send Reaction

```bash
ssh omer@100.114.126.43 'curl -s -X PUT "http://127.0.0.1:3004/api/reaction" -H "Content-Type: application/json" -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" -d "{\"session\": \"3cf11776_omer\", \"messageId\": \"MESSAGE_ID\", \"reaction\": \"EMOJI\"}"'
```

### Send Location

```bash
ssh omer@100.114.126.43 'curl -s -X POST "http://127.0.0.1:3004/api/sendLocation" -H "Content-Type: application/json" -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" -d "{\"session\": \"3cf11776_omer\", \"chatId\": \"CHAT_ID\", \"latitude\": LAT, \"longitude\": LNG, \"title\": \"TITLE\"}"'
```

### List Groups

```bash
ssh omer@100.114.126.43 'curl -s "http://127.0.0.1:3004/api/3cf11776_omer/groups" -H "X-Api-Key: XcTCX9cn84LE/uMm3SnHEvm0giwtNnHBmGR7OGeAOpA=" | python3 -c "
import json,sys
for g in json.load(sys.stdin):
    print(f\"{g.get(\"id\",\"\")} - {g.get(\"subject\",\"\")} ({g.get(\"size\",0)} members)\")
"'
```

## Guidelines

- **Default to Omer's DM** (`972544329000@c.us`) unless a specific group is requested
- **Keep messages concise** — WhatsApp has a 4096 character limit per message
- **Wait 30-60 seconds** after sending to Sammie's group before reading replies (AI processing time)
- **Never impersonate Omer** — only send as the bot session
- **Use for notifications** — task completion alerts, error reports, status updates
