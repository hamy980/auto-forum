Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-OrchestratorRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
}

function Get-RunRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskId
    )

    return Join-Path (Get-OrchestratorRoot) (Join-Path "runs" $TaskId)
}

function Get-WorkspaceRoot {
    return [System.IO.Path]::GetFullPath((Join-Path (Get-OrchestratorRoot) ".."))
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Read-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        $Data
    )

    $json = $Data | ConvertTo-Json -Depth 100
    Set-Content -LiteralPath $Path -Value $json
}

function Get-Settings {
    return Read-JsonFile -Path (Join-Path (Get-OrchestratorRoot) "config/settings.json")
}

function Get-Routes {
    return Read-JsonFile -Path (Join-Path (Get-OrchestratorRoot) "config/routes.json")
}

function Get-StatePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskId
    )

    return Join-Path (Get-RunRoot -TaskId $TaskId) "state.json"
}

function Get-TaskPromptPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskId
    )

    return Join-Path (Get-RunRoot -TaskId $TaskId) "task.md"
}

function Get-LatestReportPaths {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskId
    )

    $state = Read-JsonFile -Path (Get-StatePath -TaskId $TaskId)
    if ($null -eq $state -or [string]::IsNullOrWhiteSpace($state.latest_report_json)) {
        return [pscustomobject]@{
            JsonPath = ""
            MarkdownPath = ""
        }
    }

    return [pscustomobject]@{
        JsonPath = $state.latest_report_json
        MarkdownPath = $state.latest_report_md
    }
}

function Get-TemplatePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TemplateName
    )

    return Join-Path (Join-Path (Get-OrchestratorRoot) "templates") $TemplateName
}

function Render-Template {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TemplatePath,
        [Parameter(Mandatory = $true)]
        [hashtable]$Bindings
    )

    $text = Get-Content -LiteralPath $TemplatePath -Raw
    foreach ($key in $Bindings.Keys) {
        $token = "{{{0}}}" -f $key
        $value = [string]$Bindings[$key]
        $text = $text.Replace($token, $value)
    }

    return $text
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Command,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$InputText
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Command[0]
    if ($Command.Length -gt 1) {
        foreach ($arg in $Command[1..($Command.Length - 1)]) {
            $null = $startInfo.ArgumentList.Add($arg)
        }
    }
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    $null = $process.Start()

    $process.StandardInput.Write($InputText)
    $process.StandardInput.Close()

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        StdOut = $stdout
        StdErr = $stderr
        ProcessId = $process.Id
    }
}

function Parse-MarkedJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OutputText
    )

    $pattern = '(?s)<<<AI_FLOW_JSON_START>>>\s*(\{.*?\})\s*<<<AI_FLOW_JSON_END>>>'
    $match = [regex]::Match($OutputText, $pattern)

    if (-not $match.Success) {
        return [pscustomobject]@{
            Markdown = $OutputText.Trim()
            Json = $null
        }
    }

    $jsonText = $match.Groups[1].Value
    $markdown = [regex]::Replace($OutputText, $pattern, '').Trim()

    try {
        $json = $jsonText | ConvertFrom-Json -Depth 100
    } catch {
        $json = $null
    }

    return [pscustomobject]@{
        Markdown = $markdown
        Json = $json
    }
}

function New-FallbackReport {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskId,
        [Parameter(Mandatory = $true)]
        [string]$Agent,
        [Parameter(Mandatory = $true)]
        [string]$OutputText,
        [Parameter(Mandatory = $true)]
        [int]$ExitCode
    )

    return [pscustomobject]@{
        task_id = $TaskId
        agent = $Agent
        status = if ($ExitCode -eq 0) { "done" } else { "blocked" }
        decision = if ($ExitCode -eq 0) { "unclear" } else { "blocked" }
        summary = "Wrapper could not parse a final JSON block."
        files_changed = @()
        tests = @()
        findings = @()
        raw_output_excerpt = if ($OutputText.Length -gt 240) { $OutputText.Substring(0, 240) } else { $OutputText }
    }
}

function Write-StageArtifacts {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskId,
        [Parameter(Mandatory = $true)]
        [string]$Stage,
        [Parameter(Mandatory = $true)]
        [string]$StdOut,
        [Parameter(Mandatory = $true)]
        [string]$StdErr,
        [Parameter(Mandatory = $true)]
        $ReportJson
    )

    $runRoot = Get-RunRoot -TaskId $TaskId
    $stageRoot = Join-Path $runRoot $Stage
    Ensure-Directory -Path $stageRoot

    $stdoutPath = Join-Path $stageRoot "stdout.log"
    $stderrPath = Join-Path $stageRoot "stderr.log"
    $reportJsonPath = Join-Path $stageRoot "report.json"
    $reportMdPath = Join-Path $stageRoot "report.md"

    Set-Content -LiteralPath $stdoutPath -Value $StdOut
    Set-Content -LiteralPath $stderrPath -Value $StdErr
    Write-JsonFile -Path $reportJsonPath -Data $ReportJson

    $parsed = Parse-MarkedJson -OutputText $StdOut
    $reportMd = $parsed.Markdown
    if ([string]::IsNullOrWhiteSpace($reportMd)) {
        $reportMd = "# $Stage report`n`n$($ReportJson.summary)"
    }
    Set-Content -LiteralPath $reportMdPath -Value $reportMd

    return [pscustomobject]@{
        StdOutPath = $stdoutPath
        StdErrPath = $stderrPath
        ReportJsonPath = $reportJsonPath
        ReportMarkdownPath = $reportMdPath
    }
}

function Update-StateAfterStage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskId,
        [Parameter(Mandatory = $true)]
        [string]$Stage,
        [Parameter(Mandatory = $true)]
        $ReportJson,
        [Parameter(Mandatory = $true)]
        $Artifacts,
        [string]$NextStage = ""
    )

    $statePath = Get-StatePath -TaskId $TaskId
    $state = Read-JsonFile -Path $statePath

    if ($null -eq $state) {
        throw "State file not found for task $TaskId"
    }

    $historyEntry = [pscustomobject]@{
        timestamp = (Get-Date).ToString("o")
        stage = $Stage
        status = $ReportJson.status
        decision = $ReportJson.decision
        next_stage = $NextStage
        report_json = $Artifacts.ReportJsonPath
        report_md = $Artifacts.ReportMarkdownPath
    }

    $state.latest_report_json = $Artifacts.ReportJsonPath
    $state.latest_report_md = $Artifacts.ReportMarkdownPath
    $state.last_stage = $Stage
    $state.last_decision = $ReportJson.decision
    $state.updated_at = (Get-Date).ToString("o")

    if ($state.history -eq $null) {
        $state.history = @()
    }

    $state.history += $historyEntry

    if (-not [string]::IsNullOrWhiteSpace($NextStage)) {
        $state.next_stage = $NextStage
    }

    Write-JsonFile -Path $statePath -Data $state
    return $state
}

function Resolve-NextStage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Stage,
        [Parameter(Mandatory = $true)]
        $ReportJson,
        [Parameter(Mandatory = $true)]
        $Routes
    )

    $stageConfig = $Routes.stages.$Stage
    if ($null -eq $stageConfig) {
        return "planner"
    }

    $decision = [string]$ReportJson.decision
    if ([string]::IsNullOrWhiteSpace($decision)) {
        return [string]$stageConfig.defaultNextStage
    }

    $mapped = $stageConfig.decisionMap.$decision
    if ([string]::IsNullOrWhiteSpace([string]$mapped)) {
        return [string]$stageConfig.defaultNextStage
    }

    return [string]$mapped
}
