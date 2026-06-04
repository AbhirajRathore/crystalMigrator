# Windows setup — full project (with automated .rpt conversion)

Run these in order. Commands are PowerShell. Assumes the project folder is
`report-framework` (inside `reportMigratorDemo`).

## 0. Prerequisites — install these once

1. **Node.js 20 LTS** — https://nodejs.org → verify:
   ```powershell
   node -v   # v20.x
   npm -v
   ```
2. **.NET 8 SDK** — https://dotnet.microsoft.com/download → verify:
   ```powershell
   dotnet --version   # 8.x or 9.x
   ```
3. **.NET Framework 4.8 Developer Pack** (needed to build the converter, which targets net48) —
   https://dotnet.microsoft.com/download/dotnet-framework/net48 → "Developer Pack".
4. **SAP Crystal Reports, developer version for Visual Studio** (FREE) —
   https://www.sap.com/cmp/td/sap-crystal-reports-visual-studio-trial.html (the "runtime/developer"
   install). This installs the `CrystalDecisions.*` assemblies the converter needs.
   - Note the **bitness** you install (32-bit is the common default).

## 1. Frontend dependencies
```powershell
cd report-framework\frontend
npm install
```

## 2. Build the converter (rpt2template.exe)
```powershell
cd ..\converter\RptToTemplate
dotnet build -c Release
```
If it fails with "could not resolve CrystalDecisions...", fix the `<HintPath>`s in
`RptToTemplate.csproj` to match where the SDK installed the DLLs. Typical location:
```
C:\Program Files (x86)\SAP BusinessObjects\Crystal Reports for .NET Framework 4.0\Common\SAP BusinessObjects Enterprise XI 4.0\win32_x86\dotnet\
```
Also make `PlatformTarget` (x86/x64) match the SDK bitness you installed.

On success you get:
```
report-framework\converter\RptToTemplate\bin\Release\net48\rpt2template.exe
```
Quick test it works:
```powershell
.\bin\Release\net48\rpt2template.exe "..\..\..\Export Invoice Sale.rpt" -o out
dir out   # → *.extraction.json and *.template.json
```

## 3. Point the backend at the converter
Edit `report-framework\backend\appsettings.json`:
```json
{
  "Logging": { "LogLevel": { "Default": "Information", "Microsoft.AspNetCore": "Warning" } },
  "AllowedHosts": "*",
  "DataApi": { "BaseUrl": "http://127.0.0.1:8000" },
  "Converter": {
    "ExePath": "C:\\full\\path\\to\\report-framework\\converter\\RptToTemplate\\bin\\Release\\net48\\rpt2template.exe"
  }
}
```
Use double backslashes in JSON. `DataApi:BaseUrl` is your N1 data gateway.

## 4. Run the backend
```powershell
cd ..\..\backend
dotnet run --urls http://127.0.0.1:5249
```
Verify (new terminal):
```powershell
curl http://127.0.0.1:5249/api/v1/reports
# → [{"id":"export-invoice-sale","title":"Export Invoice Sale"}]
```

## 5. Run the frontend (second terminal)
```powershell
cd report-framework\frontend
npm run dev
# → http://localhost:5180
```

## 6. Use it
Open http://localhost:5180 → **Upload .rpt** tab → drop a `.rpt`.
Now it returns **status: ok** with the generated `template.json` → preview → **Download**.

---

## Run both at once (VS Code)
Open the project folder in VS Code → `Ctrl+Shift+P` → **Tasks: Run Task** →
**Run All (frontend + backend)**. (`.vscode/tasks.json` is already included.)

## Troubleshooting
- **`rpt2template` build can't find CrystalDecisions** → fix `<HintPath>` in the csproj; confirm the SDK installed.
- **`BadImageFormatException` at runtime** → converter bitness ≠ CR runtime bitness; rebuild with matching `PlatformTarget`.
- **Upload still says "Converter not available"** → `Converter:ExePath` is wrong or the exe isn't there; check the path and restart the backend.
- **Port 5180 in use** → change `port` in `frontend/vite.config.ts`.
- **net48 build error** → install the **.NET Framework 4.8 Developer Pack** (step 0.3).
