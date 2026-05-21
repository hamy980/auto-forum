param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId,
    [Parameter(Mandatory = $true)]
    [string]$Prompt,
    [string]$InitialStage = "coder"
)

. (Join-Path $PSScriptRoot "common.ps1")

$runRoot = Get-RunRoot -TaskId $TaskId
Ensure-Directory -Path $runRoot
Ensure-Directory -Path (Join-Path $runRoot "coder")
Ensure-Directory -Path (Join-Path $runRoot "reviewer")
Ensure-Directory -Path (Join-Path $runRoot "fixer")
Ensure-Directory -Path (Join-Path $runRoot "planner")
Ensure-Directory -Path (Join-Path $runRoot "prompts")

$taskPromptPath = Get-TaskPromptPath -TaskId $TaskId
Set-Content -LiteralPath $taskPromptPath -Value $Prompt

$state = [pscustomobject]@{
    task_id = $TaskId
    status = "running"
    current_stage = $InitialStage
    next_stage = $InitialStage
    last_stage = ""
    last_decision = ""
    latest_report_json = ""
    latest_report_md = ""
    created_at = (Get-Date).ToString("o")
    updated_at = (Get-Date).ToString("o")
    history = @()
}

Write-JsonFile -Path (Get-StatePath -TaskId $TaskId) -Data $state

Write-Host "Initialized task $TaskId at $runRoot"
& (Join-Path $PSScriptRoot "planner-runtime.ps1") -TaskId $TaskId
