# Driftsättning – Supportdashboard som Suitelet i Noresca Admin

Det här är de sista handgreppen jag inte kunde göra åt er via API (se förklaringen
i chatten – NetSuite exponerar inte Script-/Deployment-poster för skapande via
REST, och den här sessionens NetSuite-integration saknar dessutom skrivbehörighet
till File Cabinet – senast omtestat 2026-09-18, samma fel: "Permission Violation:
'Lists -> Documents and Files'"). Allt annat – koden, testningen, mallen – är klart.

Räkna med 10–15 minuter första gången.

**Uppdaterad 2026-09-18:** paketet innehåller nu den version av mallen och
scriptet som har fem oberoende linjer i trenddiagrammet (Inkomna, In Progress,
Solution proposal, Solved, Stängda) i stället för tre – se avsnitt 6 nedan.

## 1. Ladda upp filerna till File Cabinet

Gå till **Documents > Files > File Cabinet** i NetSuite.

1. Öppna mappen `SuiteScripts`.
2. Skapa en ny undermapp: **New Folder**, namnge den `supportdashboard`.
3. Gå in i den nya mappen och ladda upp (**Add File**, upprepa tre gånger) dessa tre
   filer från den här leveransen:
   - `supportdashboard_suitelet.js`
   - `dashboard_mall.html`
   - `namn.json`

   Ladda **inte** upp `supportdashboard_live.html` – den skapar scriptet självt vid
   första "Uppdatera dashboard"-klicket.
4. Kontrollera att mappen `SuiteScripts/supportdashboard/` och dess tre filer är
   läsbara för de roller som ska använda dashboarden (Administrator har alltid
   åtkomst; för supportteamets roll, öppna mappens **Properties** och lägg till
   rollen under fliken **Restrict By Group/Role/Employee** om mappen är
   åtkomstbegränsad – de flesta `SuiteScripts`-mappar är dock öppna för alla
   inloggade roller som standard, så det här steget behövs troligen inte).

## 2. Skapa Script-posten

1. Gå till **Customization > Scripting > Scripts > New**.
2. Under **Script File**, välj `supportdashboard_suitelet.js` som du precis laddade upp.
3. NetSuite läser `@NScriptType Suitelet` ur filens JSDoc-header och föreslår
   automatiskt scripttypen **Suitelet** – bekräfta det.
4. Ge scriptet ett namn, t.ex. `Supportdashboard`, och en Script ID, t.ex.
   `customscript_supportdashboard`.
5. Spara.

## 3. Skapa en Deployment

Fortfarande på Script-posten, öppna fliken **Deployments** och skapa en ny (eller
använd den som NetSuite föreslår automatiskt):

1. **Status**: `Released`.
2. **Audience / Roles**: lägg till **Administrator** samt den roll ert
   supportteam faktiskt använder mot supportcase i dag (jag kunde inte slå upp
   det exakta rollnamnet via API i det här kontot – ni vet vilken roll det är).
   Ni valde tidigare "Administrator + supportteamet", så lägg till båda.
3. **Available without Login**: låt stå **avmarkerad** (nej) – åtkomsten ska
   fortsätta gå via vanlig NetSuite-inloggning och respektera användarens egna
   behörigheter till ärenden/kunder/anställda.
4. **Execute As Role**: lämna som standard (**Current User**/tomt) – då körs
   scriptet med den inloggade personens egna läsbehörigheter, inte en
   priviligierad roll. Fungerar dashboarden inte för någon i supportteamet
   beror det troligen på att den rollen saknar läsbehörighet till Support Case,
   Customer/Job, Employee eller den custom-recordtyp som håller nyckelorden
   (`customrecord_nic_na_case_keywords`) – lägg till behörigheten på rollen i
   stället för att byta Execute As Role.
5. **Log Level**: `Audit` rekommenderas till att börja med – scriptet skriver ut
   hur många ärenden som lästes in, hur många testärenden som räknades bort, och
   flaggar kund-/handläggar-id som saknades i `namn.json` (se punkt 5 nedan). Gå
   till **Customization > Scripting > Script Deployments** och öppna
   **Execution Log** på deploymentet för att se dessa.
6. Spara. NetSuite visar nu Suitelet-URL:en direkt på deployment-posten
   (`External URL` eller den interna sökvägen under **URL**).

## 4. Första körningen

1. Öppna Suitelet-URL:en (från steg 3.6, eller Script Deployment-listan).
2. Sidan visar "Ingen dashboard är genererad än" med en **Uppdatera
   dashboard**-knapp. Klicka på den.
3. Scriptet hämtar hela ärendestocken och nyckelordstabellen via SuiteQL,
   räknar om all statistik och visar den färdiga dashboarden – samma layout,
   diagram och nedbrytning som `Noresca_supportdashboard_2026-09-18.html` som
   redan levererats (inklusive de fem trendlinjerna i sektion 4), plus ett
   svart verktygsfält högst upp med tidsstämpel och en ny **Uppdatera
   dashboard**-knapp för nästa gång.
4. Vill ni att fler ska hitta sidan snabbt: lägg till en **Shortcut** eller en
   länk i en Center-tab som pekar på samma URL.

## 5. Löpande drift

- **Uppdatera dashboard**-knappen (i det svarta fältet högst upp, eller på
  startsidan) bygger om allt från grunden direkt i samma request – ingen
  bakgrundskö, inget att vänta på i efterhand.
- **Nya kunder/handläggare**: dyker det upp ett ärende för en kund eller
  handläggare som inte finns i `namn.json`, visar scriptet automatiskt ett
  förenklat rensat namn (samma regel som för stängda-bara kunder i Python-
  pipelinen) i stället för att krascha, och skriver en rad i Execution Log
  (`supportdashboard: okända kund-id` / `okända handläggar-id`). Vill ni ha det
  riktiga, kurerade namnet (moderbolagets namn, korrekt avtalsnivå/SDM): lägg
  till posten i `namn.json`-filen i File Cabinet (samma format som i Cowork-
  skillen `supportdashboard`, se dess `references/netsuite-uttag.md`) och kör
  Uppdatera igen.
- **Nyckelordstabellen** (parent-hierarki och kategori) hämtas fräscht från
  NetSuite vid varje Uppdatera – ingen fil att underhålla där, till skillnad
  från tidigare.
- **Om layouten i dashboarden ska ändras** (nya diagram, nya filter): gör
  ändringen i `assets/dashboard_mall.html` i Cowork-skillen **och** ladda upp
  samma uppdaterade fil till `SuiteScripts/supportdashboard/dashboard_mall.html`
  igen – de är två kopior av samma mall i två separata miljöer och hålls i synk
  manuellt, det finns ingen automatisk länk mellan dem.
- **Om ärendestocken växer mycket** (många tusen ärenden): scriptet gör hela
  jobbet direkt i en enda Suitelet-request. Fungerar det bra i dag (drygt 1 600
  ärenden) men skulle på sikt kunna bli långsamt eller stöta på NetSuites
  tidsgräns för Suitelets om stocken blir mycket större. Märks det, säg till så
  bygger jag om uppdateringen till ett bakgrundsjobb (Map/Reduce) i stället –
  det alternativet valdes bort nu för att hålla det enkelt.

## 6. Vad som redan är verifierat

Aggregeringslogiken i `supportdashboard_suitelet.js` är en fältnamnskompatibel
portering av `bygg_dashboard.py` i Cowork-skillen. Den är testad i det här
sammanhanget (utan en riktig NetSuite-miljö att köra i) genom att köra om exakt
samma redan hämtade NetSuite-data genom båda implementationerna och jämföra
nyckeltalen – `test_suitelet_logic.js` i den här leveransen gör det automatiskt
och får samma resultat som `Noresca_supportdashboard_2026-09-18.html` (77 öppna
ärenden, 1 530 totalt efter testfilter, samma topplista för nyckelordskategorier
osv.), plus specifika kontroller av de tre nya milstolpsfälten
(`custevent_nic_na_case_sla_ms1_date`/`_ms2_date`/`_ms3_date`) mot ett känt
verkligt ärende, och en Playwright-körning i en riktig webbläsare av den
genererade sidan (inklusive det nya verktygsfältet och sektion 4:s fem linjer)
som inte gav några JS-fel. Kör `node test_suitelet_logic.js` igen om ni ändrar
aggregeringslogiken, för att fånga regressioner innan ni laddar upp en ny
version till NetSuite.
