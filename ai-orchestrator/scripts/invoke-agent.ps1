param(
    [Parameter(Mandatory = $true)]
    [string]$TaskId,
    [Parameter(Mandatory = $true)]
    [ValidateSet("coder", "reviewer", "fixer")]
    [string]$Stage
)

. (Join-Path $PSScriptRoot "common.ps1")

$settings = Get-Settings
$routes = Get-Routes
$statePath = Get-StatePath -TaskId $TaskId
$state = Read-JsonFile -Path $statePath

if ($null -eq $state) {
    throw "State file not found for task $TaskId"
}

$runRoot = Get-RunRoot -TaskId $TaskId
$workspaceRoot = Get-WorkspaceRoot
$promptText = Get-Content -LiteralPath (Get-TaskPromptPath -TaskId $TaskId) -Raw
$latest = Get-LatestReportPaths -TaskId $TaskId
$skillPrefix = [string]$routes.stages.$Stage.skillPrefix

$templateName = "{0}.prompt.txt" -f $Stage
$renderedPrompt = Render-Template -TemplatePath (Get-TemplatePath -TemplateName $templateName) -Bindings @{
    SKILL_PREFIX = $skillPrefix
    TASK_ID = $TaskId
    TASK_PROMPT = $promptText
    WORKDIR = $workspaceRoot
    STATE_JSON_PATH = $statePath
    LATEST_REPORT_JSON_PATH = $latest.JsonPath
    LATEST_REPORT_MD_PATH = $latest.MarkdownPath
}

$promptFile = Join-Path (Join-Path $runRoot "prompts") ("{0}.{1}.prompt.txt" -f $TaskId, $Stage)
Set-Content -LiteralPath $promptFile -Value $renderedPrompt

$result = Invoke-ExternalCommand -Command $settings.claude.command -WorkingDirectory $workspaceRoot -InputText $renderedPrompt
$parsed = Parse-MarkedJson -OutputText $result.StdOut
$reportJson = $parsed.Json

if ($null -eq $reportJson) {
    $reportJson = New-FallbackReport -TaskId $TaskId -Agent $Stage -OutputText $result.StdOut -ExitCode $result.ExitCode
}

$artifacts = Write-StageArtifacts -TaskId $TaskId -Stage $Stage -StdOut $result.StdOut -StdErr $result.StdErr -ReportJson $reportJson

$output = [pscustomobject]@{
    stage = $Stage
    exit_code = $result.ExitCode
    process_id = $result.ProcessId
    report = $reportJson
    artifacts = $artifacts
}

$output | ConvertTo-Json -Depth 100
