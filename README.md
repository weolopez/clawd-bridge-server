# Archie Bridge Server

Bridge between Weo's website and the Archie assistant session.

## Security
The server requires the `CLAWDBOT_TOKEN` environment variable to be set.
**DO NOT** commit the token to this repository.

## Running the Server
```bash
export CLAWDBOT_TOKEN="your_new_token_here"
deno run --allow-net --allow-env main.ts
```
