param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId
)

. (Join-Path $PSScriptRoot "common.ps1")

$settings = Get-Settings
$statePath = Get-StatePath -TaskId $TaskId
$state = Read-JsonFile -Path $statePath

if ($null -eq $state) {
    throw "State file not found for task $TaskId"
}

$promptText = Get-Content -LiteralPath (Get-TaskPromptPath -TaskId $TaskId) -Raw
$latest = Get-LatestReportPaths -TaskId $TaskId
$runRoot = Get-RunRoot -TaskId $TaskId
$workspaceRoot = Get-WorkspaceRoot

$renderedPrompt = Render-Template -TemplatePath (Get-TemplatePath -TemplateName "planner.prompt.txt") -Bindings @{
    TASK_ID = $TaskId
    TASK_PROMPT = $promptText
    WORKDIR = $workspaceRoot
    STATE_JSON_PATH = $statePath
    LATEST_REPORT_JSON_PATH = $latest.JsonPath
    LATEST_REPORT_MD_PATH = $latest.MarkdownPath
}

$promptFile = Join-Path (Join-Path $runRoot "prompts") ("{0}.planner.prompt.txt" -f $TaskId)
Set-Content -LiteralPath $promptFile -Value $renderedPrompt

$result = Invoke-ExternalCommand -Command $settings.codex.command -WorkingDirectory $workspaceRoot -InputText $renderedPrompt
$parsed = Parse-MarkedJson -OutputText $result.StdOut
$reportJson = $parsed.Json

if ($null -eq $reportJson) {
    $fallback = New-FallbackReport -TaskId $TaskId -Agent "planner" -OutputText $result.StdOut -ExitCode $result.ExitCode
    $reportJson = [pscustomobject]@{
        task_id = $fallback.task_id
        agent = $fallback.agent
        status = $fallback.status
        decision = $fallback.decision
        summary = $fallback.summary
        files_changed = $fallback.files_changed
        tests = $fallback.tests
        findings = $fallback.findings
        raw_output_excerpt = $fallback.raw_output_excerpt
        next_stage = "blocked"
        reason = "Planner output did not include a valid JSON block."
    }
}

$artifacts = Write-StageArtifacts -TaskId $TaskId -Stage "planner" -StdOut $result.StdOut -StdErr $result.StdErr -ReportJson $reportJson

$output = [pscustomobject]@{
    stage = "planner"
    exit_code = $result.ExitCode
    process_id = $result.ProcessId
    report = $reportJson
    artifacts = $artifacts
}

$output | ConvertTo-Json -Depth 100
