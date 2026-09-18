# Supportdashboard – NetSuite Suitelet (SDF-projekt)

Det här är en [SuiteCloud Development Framework](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4702622163.html)
(SDF)-projektstruktur för att driftsätta Supportdashboarden som en Suitelet
direkt i Noresca Admin (NetSuite, konto 57409) – via VS Code och git, i
stället för att ladda upp filerna manuellt i NetSuites webbgränssnitt.

Suiteleten visar samma dashboard som den fristående HTML-filen
(`Noresca_supportdashboard_<datum>.html`) – öppen backlog, avvikelser i
hanteringen, in-/utflöde (fem linjer: Inkomna, In Progress, Solution
proposal, Solved, Stängda), nyckelordsanalys och kundbild – men hämtar och
räknar om all data direkt i NetSuite vid varje klick på **Uppdatera
dashboard**, i stället för att vara en ögonblicksbild.

## Innehåll

```
manifest.xml                                     Projektmetadata (SDF)
deploy.xml                                        Vad som ska laddas upp och i vilken ordning
src/
├── Objects/
│   └── customscript_supportdashboard.xml         Script- och deployment-posten (Suitelet)
└── FileCabinet/SuiteScripts/supportdashboard/
    ├── supportdashboard_suitelet.js               Själva scriptet (aggregering + HTML-rendering)
    ├── dashboard_mall.html                         HTML/CSS/JS-mallen scriptet fyller med data
    ├── namn.example.json                           Exempel/mall för namn.json (se varning nedan)
    └── namn.json                                   Skapas lokalt av dig – se "Kund-/handläggarnamn"
docs/
├── test_suitelet_logic.js                          Node-regressionstest av aggregeringslogiken
└── DRIFTSATTNING-manuell-uppladdning.md            Alternativ: driftsättning utan SDF/VS Code
```

## ⚠️ Kund-/handläggarnamn – läs innan du committar

`namn.json` innehåller riktiga kund- och personnamn ur er NetSuite och är
avsiktligt **inte** incheckad i git (se `.gitignore`). Innan första
`suitecloud project:deploy`:

1. Kopiera `namn.example.json` till `namn.json` i samma mapp.
2. Fyll i riktiga kund-/handläggar-id:n och namn (formatet beskrivs i
   `docs/DRIFTSATTNING-manuell-uppladdning.md`, avsnitt 5, och i
   `netsuite-uttag.md` i Cowork-skillen `supportdashboard`).

SDF laddar upp filen från din lokala disk oavsett vad `.gitignore` säger –
`.gitignore` styr bara vad som hamnar i git-historiken/GitHub, inte vad
`project:deploy` skickar till NetSuite.

## Förutsättningar

- **Node.js** (för SuiteCloud CLI).
- **SuiteCloud CLI**: `npm install -g @oracle/suitecloud-cli`
  (eller installera [SuiteCloud Extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=Oracle.suitecloud-vscode-extension)
  från Marketplace, som bundlar CLI:et och ger validering/deploy direkt i VS Code).
- En NetSuite-roll med behörigheten **SuiteCloud Development Framework**
  (Setup → Users/Roles → Manage Roles). Det här är en annan behörighetsväg än
  REST-integrationen som användes tidigare i den här leveransen – den hade
  inte skrivbehörighet till File Cabinet, men SDF-deploy använder en egen
  autentisering (TBA eller OAuth 2.0 Machine-to-Machine) kopplad till en roll
  du väljer själv. Använd gärna Administrator-rollen för just den här
  engångsdeployen om supportteamets vanliga roll saknar SDF-behörigheten.

## Sätt upp och driftsätt

```bash
# 1. Logga in (skapar en sparad autentiseringsprofil, en gång per konto/roll)
suitecloud account:setup

# 2. Validera projektet mot ert konto (skapar inget, bara kontrollerar)
suitecloud project:validate

# 3. Ladda upp och skapa Script- och Deployment-posterna
suitecloud project:deploy
```

`account:setup` går igenom ett interaktivt flöde för Token-Based
Authentication (TBA) eller OAuth 2.0 – följ NetSuites egna prompter, inga
hemligheter behöver skrivas in i något av projektets filer.

## Efter driftsättning – manuellt steg som inte ligger i XML:et

`src/Objects/customscript_supportdashboard.xml` skapar Suiteleten med
status `RELEASED` men **utan** någon roll/publik satt på deploymentet –
medvetet, eftersom vi inte kände till era exakta rollnamn härifrån. Öppna
Script Deployment-posten i NetSuite (Customization → Scripting → Script
Deployments) och lägg till **Administrator** samt supportteamets roll under
fliken **Audience**, annars kan ingen öppna sidan.

## Löpande drift

Samma som för den manuella varianten – se
`docs/DRIFTSATTNING-manuell-uppladdning.md`, avsnitt 5: `namn.json`
uppdateras manuellt vid nya kunder/handläggare, nyckelordstabellen hämtas
färskt från NetSuite vid varje klick på Uppdatera, och layoutändringar görs i
`dashboard_mall.html` här och i Cowork-skillens `assets/dashboard_mall.html`
(två kopior, ingen automatisk länk mellan dem).

## Regressionstest

`docs/test_suitelet_logic.js` körde aggregeringslogiken i
`supportdashboard_suitelet.js` mot verklig NetSuite-data (Node, utan riktig
SuiteScript-runtime) och jämförde nyckeltalen mot Python-referensbygget –
alla test gröna vid leverans 2026-09-18. De faktiska datafilerna
(`data/raw_page1.txt`, `raw_page2.txt`, `namn.json`, `nyckelord.json`)
innehåller riktig ärende- och kunddata och är **inte** inkluderade i det här
repot. Vill du köra om testet, exportera samma filer på nytt från er
NetSuite-miljö (se `netsuite-uttag.md` i Cowork-skillen) och lägg dem i en
lokal `data/`-mapp bredvid testfilen innan du körs `node
test_suitelet_logic.js`.

## Alternativ: manuell uppladdning utan SDF

Om ni av något skäl inte vill sätta upp SuiteCloud CLI just nu, ligger
samma tre filer plus en steg-för-steg-guide för att skapa Script- och
Deployment-posterna för hand i NetSuites webbgränssnitt i
`docs/DRIFTSATTNING-manuell-uppladdning.md`.
