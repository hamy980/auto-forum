param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId
)

. (Join-Path $PSScriptRoot "common.ps1")

$settings = Get-Settings
$routes = Get-Routes
$maxCycles = [int]$settings.runtime.maxCycles
$statePath = Get-StatePath -TaskId $TaskId
$state = Read-JsonFile -Path $statePath

if ($null -eq $state) {
    throw "State file not found for task $TaskId"
}

for ($cycle = 1; $cycle -le $maxCycles; $cycle++) {
    $state = Read-JsonFile -Path $statePath
    if ($state.status -in @("completed", "blocked")) {
        break
    }

    $currentStage = [string]$state.next_stage
    if ([string]::IsNullOrWhiteSpace($currentStage)) {
        $currentStage = [string]$state.current_stage
    }

    if ([string]::IsNullOrWhiteSpace($currentStage)) {
        $currentStage = "planner"
    }

    if ($currentStage -eq "complete") {
        $state.status = "completed"
        $state.updated_at = (Get-Date).ToString("o")
        Write-JsonFile -Path $statePath -Data $state
        break
    }

    if ($currentStage -eq "blocked") {
        $state.status = "blocked"
        $state.updated_at = (Get-Date).ToString("o")
        Write-JsonFile -Path $statePath -Data $state
        break
    }

    if ($currentStage -eq "planner") {
        Write-Host "[$TaskId] Cycle ${cycle}: planner"
        $plannerOutput = & (Join-Path $PSScriptRoot "invoke-planner.ps1") -TaskId $TaskId | ConvertFrom-Json -Depth 100
        $nextStage = [string]$plannerOutput.report.next_stage
        if ([string]::IsNullOrWhiteSpace($nextStage)) {
            $nextStage = "blocked"
        }

        $state = Update-StateAfterStage -TaskId $TaskId -Stage "planner" -ReportJson $plannerOutput.report -Artifacts $plannerOutput.artifacts -NextStage $nextStage
        $state.current_stage = "planner"
        $state.next_stage = $nextStage
        $state.status = if ($nextStage -eq "blocked") { "blocked" } elseif ($nextStage -eq "complete") { "completed" } else { "running" }
        Write-JsonFile -Path $statePath -Data $state
        continue
    }

    Write-Host "[$TaskId] Cycle ${cycle}: $currentStage"
    $agentOutput = & (Join-Path $PSScriptRoot "invoke-agent.ps1") -TaskId $TaskId -Stage $currentStage | ConvertFrom-Json -Depth 100
    $nextStage = Resolve-NextStage -Stage $currentStage -ReportJson $agentOutput.report -Routes $routes

    $state = Update-StateAfterStage -TaskId $TaskId -Stage $currentStage -ReportJson $agentOutput.report -Artifacts $agentOutput.artifacts -NextStage $nextStage
    $state.current_stage = $currentStage
    $state.next_stage = $nextStage
    $state.status = if ($nextStage -eq "complete") { "completed" } elseif ($nextStage -eq "blocked") { "blocked" } else { "running" }
    Write-JsonFile -Path $statePath -Data $state
}

$finalState = Read-JsonFile -Path $statePath
if ($finalState.status -eq "running") {
    $finalState.status = "blocked"
    $finalState.next_stage = "planner"
    $finalState.updated_at = (Get-Date).ToString("o")
    Write-JsonFile -Path $statePath -Data $finalState
}

Get-Content -LiteralPath $statePath -Raw
