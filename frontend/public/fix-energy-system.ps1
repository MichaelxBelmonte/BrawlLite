# Script per correggere il problema di EnergySystem duplicato
$appjs = Get-Content .\app.js -Raw

# Trova l'inizio della seconda dichiarazione di EnergySystem
$startLine = "// Nuova implementazione dell'EnergySystem"
$endLine = "// ... existing code ..."

# Trova la posizione dell'inizio della dichiarazione
$startPos = $appjs.IndexOf($startLine)
if ($startPos -eq -1) {
    Write-Error "Non è stata trovata la seconda dichiarazione di EnergySystem"
    exit 1
}

# Trova la fine della dichiarazione
$endSearch = $appjs.Substring($startPos)
$endPos = $endSearch.IndexOf($endLine)
if ($endPos -eq -1) {
    Write-Error "Non è stata trovata la fine della classe EnergySystem"
    exit 1
}

# Calcola la posizione finale
$endPos = $startPos + $endPos

# Estrai le parti del file
$beforeClass = $appjs.Substring(0, $startPos)
$classText = $appjs.Substring($startPos, $endPos - $startPos)
$afterClass = $appjs.Substring($endPos)

# Commenta la classe
$commentedClass = "// Nuova implementazione dell'EnergySystem (commentata per evitare duplicazione)" + "`r`n" +
                  "/* RIMOSSO AUTOMATICAMENTE - EnergySystem è già dichiarato in precedenza`r`n" +
                  $classText.Substring($startLine.Length) +
                  "*/`r`n"

# Crea il nuovo contenuto
$newContent = $beforeClass + $commentedClass + $afterClass

# Crea un backup del file originale
Copy-Item .\app.js .\app.js.bak -ErrorAction SilentlyContinue

# Scrivi il nuovo contenuto
Set-Content .\app.js -Value $newContent -Encoding UTF8

Write-Host "Modifica completata con successo. La seconda dichiarazione di EnergySystem è stata commentata." 