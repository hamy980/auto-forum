# AI Orchestrator

This folder contains a lightweight planner/runtime wrapper for a multi-stage flow:

- `coder`
- `reviewer`
- `fixer`
- optional `planner` fallback

It is designed for this constraint:

- Claude runner command is fixed to `ollama launch claude --model glm-5.1:cloud`
- task input is sent through `stdin`
- planner should not stay alive watching agents

The runtime is event/process driven and does not spend model tokens while waiting.

## Structure

- `config/settings.json`: command configuration
- `config/routes.json`: stage routing rules
- `templates/`: prompt templates
- `scripts/`: PowerShell wrappers
- `runs/`: generated task state, prompts, reports, and logs

## Main commands

Start a task:

```powershell
powershell -NoProfile -File .\ai-orchestrator\scripts\start-task.ps1 -TaskId T-001 -Prompt "Implement login retry flow"
```

Resume a task:

```powershell
powershell -NoProfile -File .\ai-orchestrator\scripts\planner-runtime.ps1 -TaskId T-001
```

Run a single stage manually:

```powershell
powershell -NoProfile -File .\ai-orchestrator\scripts\invoke-agent.ps1 -TaskId T-001 -Stage reviewer
```

Force planner decision:

```powershell
powershell -NoProfile -File .\ai-orchestrator\scripts\invoke-planner.ps1 -TaskId T-001
```

## Expected model output

Each agent and planner is asked to return:

1. A normal markdown report.
2. A JSON block wrapped with markers:

```text
<<<AI_FLOW_JSON_START>>>
{ ... }
<<<AI_FLOW_JSON_END>>>
```

The wrapper writes:

- `report.md`
- `report.json`
- `stdout.log`
- `stderr.log`

under `ai-orchestrator/runs/<task-id>/`.

## Notes

- Edit `config/settings.json` if your `codex` command differs.
- The runtime only calls planner when stage routing is unclear or blocked.
- Most loops should resolve from `report.json` without planner tokens.
