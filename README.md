# distributed-memory-optimization-suite

Memory management tools for optimizing agent memory usage in distributed systems

## Features

- Production-ready code
- TypeScript/Python with full type safety
- Comprehensive error handling
- Built by Retsumdk

## Installation

```bash
git clone https://github.com/Retsumdk/distributed-memory-optimization-suite.git
cd distributed-memory-optimization-suite
bun install
```

## Usage

```bash
bun run src/index.ts --help
```

## Configuration

Create `config.json` (TypeScript) or `config.yaml` (Python) for custom settings.

## Architecture

`distributed-memory-optimization-suite` is a Bun/TypeScript CLI that loads a
local `config.json` at runtime, applies sane defaults (API base URL, request
timeout, retry count), and routes each run through a single entrypoint:

```
src/index.ts    CLI entrypoint (Commander-based, --config / --verbose)
  └─ loadConfig()  reads config.json and merges site defaults
  └─ main()        executes the memory-optimization pass with merged config
tests/           smoke test verifying the module loads and runs
```

The design keeps all tunables external to the code, so operators can change
retry or timeout behavior without rebuilding.

## Real-World Use Case

A distributed agent fleet that keeps per-agent memory in worker processes can
run this suite as a scheduled compaction step: point `baseUrl` at the memory
service, set an aggressive `timeout` with retries during slow-compaction
windows, and schedule it on cron so compressed snapshots are produced without
manual intervention. The JSON config is environment-portable, so the same
binary promotes cleanly from staging to production.

## Configuration reference

```json
{
  "baseUrl": "https://memory.example.com",
  "timeout": 30000,
  "retries": 3
}
```

- `baseUrl` — memory / backend service to compact against
- `timeout` — per-request timeout in milliseconds
- `retries` — number of attempts before the run is abandoned

## License

MIT License

---

Built by [Retsumdk](https://github.com/Retsumdk)
