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
suitecloud.config.js                             Krävs av SuiteCloud CLI/VS Code-tillägget – pekar ut src/ som projektmapp
src/
├── manifest.xml                                  Projektmetadata (SDF)
├── deploy.xml                                     Vad som ska laddas upp och i vilken ordning
├── Objects/
│   ├── customscript_supportdashboard.xml              Script- och deployment-posten (Suitelet)
│   ├── customscript_supportdashboard_kpi.xml          Script- och deployment-posten (KPI-portlet, se nedan)
│   ├── customscript_supportdashboard_nyckelord.xml    Script- och deployment-posten (Nyckelord-portlet, se nedan)
│   ├── customscript_supportdashboard_kundbild.xml     Script- och deployment-posten (Kundbild-portlet, se nedan)
│   └── customscript_supportdashboard_trend10.xml      Script- och deployment-posten (Trend 10d-portlet, se nedan)
└── FileCabinet/SuiteScripts/supportdashboard/
    ├── supportdashboard_suitelet.js               Suiteleten (aggregering + HTML-rendering, hela dashboarden)
    ├── supportdashboard_portlet.js                 Kompakt KPI-portlet (sektion 4) för NetSuite-dashboarden
    ├── supportdashboard_portlet_nyckelord.js       Kompakt Nyckelord-portlet (sektion 5), topp-3 i alla tre nedbrytningar
    ├── supportdashboard_portlet_kundbild.js        Kompakt Kundbild-portlet (sektion 6), topp 5 kunder efter öppen backlog, länkar till fokusvy
    ├── supportdashboard_portlet_trend10.js         Kompakt Trend-portlet (sektion 4), dagsgranularitet senaste 10 dagarna, länkar till fokusvy
    ├── dashboard_mall.html                         HTML/CSS/JS-mallen Suiteleten fyller med data – inkl. fokusvy (se nedan)
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

## KPI-portlet på NetSuite-dashboarden

`supportdashboard_portlet.js` är ett andra script i samma projekt – en
**Portlet** (skild scripttyp från Suitelet) som visar fyra nyckeltal (öppen
backlog, utan första svar, tysta > 30 dagar, netto 30 dagar) direkt i en ruta
på NetSuite-dashboarden, med en knapp vidare till den fulla dashboarden.

Den är medvetet mycket lättare än Suiteleten: ingen namn-/nyckelordsuppslag,
ingen HTML-rendering av hela sidan – bara en riktad SuiteQL-fråga och en liten
HTML-sträng. Resultatet cachas 15 minuter (`N/cache`) eftersom en portlet
räknas om varje gång någon öppnar sin dashboard; utan cache hade samma fråga
kunnat köras dussintals gånger per dag. Siffrorna är därför upp till 15
minuter gamla – för en färsk siffra just nu, öppna den fulla dashboarden och
klicka **Uppdatera dashboard**.

`suitecloud project:deploy` skapar Script- och Deployment-posten för
portleten precis som för Suiteleten, men **att faktiskt lägga portleten på en
dashboard är ett användarsteg som inte går att göra via SDF**:

1. Öppna valfri Dashboard i NetSuite → **Personalize** (uppe till höger).
2. Under **Standard Content**, dra **Custom Portlet** till dashboarden.
3. Klicka **Set Up** i den nya rutan → välj **Supportdashboard KPI** i
   listan **Source** (det är samma namn som scriptet fick i XML:et) → Save.
4. Precis som Suiteletens deployment saknar denna sitt Audience/roller från
   XML:et av samma skäl som ovan – lägg till rollerna manuellt på
   `customdeploy_supportdashboard_kpi` innan andra i teamet kan välja den i
   steg 3.

Portleten är en egen, kompletterande vy – den ersätter inte Suiteleten, och
den delar ingen kod med `dashboard_mall.html` (den bygger sin egen lilla
HTML-sträng i stället för att återanvända mallen, som är byggd för en hel
sida, inte en dashboard-ruta).

## Nyckelord- och Kundbild-portletarna

Samma mönster som KPI-portleten ovan, men för sektion 5 (Nyckelord) och
sektion 6 (Kundbild) i huvuddashboarden. Tre separata portletar i stället för
en gemensam, eftersom varje NetSuite-dashboardruta bara har plats för en
avgränsad vy och de tre sektionerna svarar på olika frågor.

**`supportdashboard_portlet_nyckelord.js`** visar tre kompakta topplistor
sida vid sida – Ämnesområden, Nyckelord, Kategorier – men **topp 3** i var
och en (huvuddashboarden visar topp 5) för att alla tre ska få plats i en
och samma ruta. Räknar över **hela ärendestocken**, inte bara öppen backlog,
precis som sektion 5 i huvuddashboarden – och speglar samma
klassificeringsregler: ämnesområde = nyckelordets överordnade nyckelord med
self-parent-regeln (`kwParent()` i `dashboard_mall.html`), kategori är ett
separat fält på nyckelordet (`custrecord_nic_na_key_cat`), inte samma
gruppering trots att ett par etiketter råkar heta likadant (se README-avsnittet
"Nyckelordsanalys" i Cowork-skillen `supportdashboard` för samma caveat i
detalj).

**`supportdashboard_portlet_kundbild.js`** visar de fem kunder som just nu
har flest **öppna** ärenden (samma STANGDA=[5,9]-definition som resten av
projektet), med avtalsnivå per kund och en tydlig markering av kunder utan
Noresca Admin-avtal ("No SLA"). Namn och avtalsnivå läses från samma
`namn.json` som Suiteleten – ingen egen entity-uppslagning, för att hålla
portleten billig. Knappen längst ner öppnar **inte** hela dashboarden utan
en fokusvy av sektion 6 – se "Fokusvyer" nedan.

Båda cachas 15 minuter (`N/cache`) av samma skäl som KPI-portleten.

Driftsättning och aktivering är identiskt med KPI-portleten ovan:

1. `suitecloud project:deploy` skapar Script- och Deployment-posterna
   (`customdeploy_supportdashboard_nyckelord` respektive
   `customdeploy_supportdashboard_kundbild`).
2. I NetSuite: Personalize Dashboard → dra **Custom Portlet** till
   dashboarden → Set Up → välj **Supportdashboard Nyckelord** respektive
   **Supportdashboard Kundbild** i listan **Source** → Save. Upprepa för
   varje portlet du vill ha synlig.
3. Lägg till Audience/roller manuellt på de två nya deploymenten
   (Customization → Scripting → Script Deployments), av samma skäl som
   Suiteleten och KPI-portleten – XML:et sätter medvetet ingen roll.

## Trend-portleten (10 dagar), fokusvyer och klickbara KPI-siffror

Tre saker hör ihop här: en fjärde portlet som visar en kort trendglimt, ett
sätt att öppna en enskild sektion av huvuddashboarden – med samma filter som
i headern – i ett eget fönster, och samma mekanism återanvänd för att göra
KPI-portletens fyra siffror klickbara ner till ärendelistan.

### Fokusvyer (`#vy=kundbild` / `#vy=trend` / `#vy=drill&metric=…`)

Suiteleten (`supportdashboard_suitelet.js`) och mallen (`dashboard_mall.html`)
har fått stöd för att öppnas med en extra bit i URL:en, `#vy=…`, som visar
bara **en** sektion (eller en enskild ärendelista, se "drill" nedan) i
stället för hela dashboarden – men med exakt samma filterrad (Kund, Avtal,
Typ, Arbetsart) som huvuddashboardens header, och exakt samma
renderingslogik (samma `renderAll()`/`trend()`/`renderKund()`/`openDrill()`
som annars). Inget nytt script eller ny data krävs – det är samma cachade
`supportdashboard_live.html`-fil som redan serveras, bara med CSS-regler i
mallen (`:root[data-vy="…"]`) som döljer övriga sektioner klientsidan innan
sidan hinner måla upp dem.

**Viktigt: detta är ett URL-FRAGMENT (`#vy=…`), inte en vanlig
query-parameter (`?vy=…`).** En tidigare version av den här funktionen
använde `?vy=…`, och den visade sig ha ett allvarligt problem: NetSuites/
Akamais infrastruktur kunde servera en äldre, cachad version av sidan för
just den specifika query-strängen – även efter att "Uppdatera dashboard"
redan hade körts och grundURL:en (utan `vy`) gav en helt färsk sida. Ett
fragment skickas aldrig till servern (webbläsaren gör en identisk HTTP-
förfrågan oavsett vad som står efter `#`), så samma cache-lager kan aldrig
skilja på en fokusvy-länk och den vanliga dashboard-länken – problemet
försvinner helt i stället för att behöva felsökas i NetSuites/Akamais
cache-lager, som vi inte har insyn i eller kontroll över. Suiteletens
`onRequest` bryr sig fortfarande bara om `action=refresh`/POST och rör inte
fragmentet alls (det når aldrig servern), så ingen serverändring krävdes.

Giltiga värden:

- `#vy=kundbild` – visar bara sektion 6 (Kundbild).
- `#vy=trend` – visar bara sektion 4 (Inflöde mot utflöde, med sin vanliga
  12/24-månadersväxlare).
- `#vy=drill&metric=backlog|utan_forstasvar|tysta30|nya30` – visar bara
  ärendelistan (samma panel som huvuddashboardens `openDrill()`, men som
  huvudinnehåll i stället för en slide-in-panel) bakom ett av de fyra måtten
  i KPI-portleten. Se "Klickbara siffror i KPI-portleten" nedan.

Ett okänt eller saknat värde ger hela dashboarden som vanligt (dagens
beteende, oförändrat). En liten länk "← Visa hela dashboarden" läggs till
automatiskt i fokusvyn, och i drill-vyn går även Stäng-knappen, klick
utanför panelen och Escape dit i stället för att bara dölja panelen (det
finns inget bakom den att visa istället).

Fokusvyerna är fullt reaktiva mot filtren: ändrar man Kund/Avtal/Typ/
Arbetsart i headern medan en fokusvy är öppen uppdateras innehållet precis
som i den vanliga dashboarden, inklusive drill-ärendelistan.

### Klickbara siffror i KPI-portleten

`supportdashboard_portlet.js`s fyra rutor (Öppen backlog, Utan första svar,
Tysta > 30 dagar, Netto 30 dagar) är nu klickbara länkar, inte bara text.
Varje siffra öppnar en `#vy=drill&metric=…`-fokusvy i ett eget fönster med
ärendelistan bakom just det talet – samma tabell och samma logik som när man
klickar en siffra i den fulla dashboarden. Måttdefinitionerna (vilka
ärenden hör till varje siffra) ligger i `DRILL_DEFINITIONER` i
`dashboard_mall.html` och hålls i synk manuellt med portletens egna
beräkningar (samma mönster som STANGDA/TESTMONSTER). "Netto 30 dagar" är en
differens (inkomna minus stängda) och kan inte peka på en enda ärendelista –
den länkar till "inkomna senaste 30 dagarna" som närmaste enskilda lista;
säg till om ni i stället vill se båda listorna (inkomna och stängda) sida
vid sida.

### `supportdashboard_portlet_trend10.js`

Speglar sektion 4, men med **dagsgranularitet över de senaste 10 dagarna** i
stället för sektion 4:s månadsvisa 12/24-månadersvy – tänkt som en snabb
"vad hände nyligen"-glimt, inte en ersättning för den riktiga trenden.
Samma fem flöden (Inkomna, In Progress, Solution proposal, Solved, Stängda)
över **hela ärendestocken**, samma definitioner som sektion 4. Diagrammet är
en helt statisk, förberäknad SVG utan inline-JS – flera Custom Portlets kan
ligga på samma NetSuite-dashboardsida samtidigt, och den här portleten
undviker medvetet globala JS-namn som skulle kunna krocka med andra
portletar.

Knappen längst ner öppnar sektion 4 i sin fulla (månadsvisa) form som
fokusvy (`#vy=trend`) i ett eget fönster – inte en 10-dagarsversion av den
fulla vyn.

Cachas 15 minuter, precis som övriga portletar.

### Driftsättning – alla fyra portletar

Identiskt mönster för samtliga (KPI, Nyckelord, Kundbild, Trend 10d):

1. `suitecloud project:deploy` skapar Script- och Deployment-posterna,
   inklusive den nya `customdeploy_supportdashboard_trend10`.
2. I NetSuite: Personalize Dashboard → dra **Custom Portlet** till
   dashboarden → Set Up → välj **Supportdashboard Trend 10d** i listan
   **Source** → Save.
3. Lägg till Audience/roller manuellt på `customdeploy_supportdashboard_trend10`
   (Customization → Scripting → Script Deployments), av samma skäl som de
   andra deploymenten – XML:et sätter medvetet ingen roll.

Länkarna från Kundbild- och Trend 10d-portletarna öppnas i en ny flik/fönster
(`target="_blank"`) via webbläsarens standardbeteende – vill ni i stället ha
ett riktigt, mindre popup-fönster (utan adressfält/flikrad) krävs ett litet
JS-anrop (`window.open(url,'_blank','width=…,height=…')`) i stället för en
vanlig länk; hör av er om ni vill ha det.

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
