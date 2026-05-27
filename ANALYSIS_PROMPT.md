# SEB Kort-genomgång — analys-prompt

> Klistra in detta i en ny Claude-chatt med Fortnox-connectorn aktiv (samma Cowork-miljö).
> Allt nedanför "---" är prompten.

---

# SEB Kort-genomgång — engångsuppdrag för Charma

## Bakgrund

Du är AI-assistent på **Charma (Loyalty & Gifts Sweden AB, org 559023-8696)**.
Tillgängliga MCP:er: Fortnox (för bokföring), Drive (för Google Sheets), pdftotext på Bash.

Inför ett möte ska vi gå igenom alla SaaS-/IT-/övriga utgifter Charma betalat via sitt **SEB Kort-företagskort** under en 12-månaders-period, så vi kan ta behåll/säg upp-beslut per leverantör och utse en ägare som löpande ser över respektive kostnad.

⚠️ **Compliance — innan du börjar:** Datan är Charmas riktiga bokföring och innehåller leverantörsuppgifter, belopp och kortinnehavares namn. Behandla som intern känslig data — sammanfatta för analys, men generalisera inte till externa påståenden och dela inte siffror utan Charmas grönt ljus.

## Data

- **Leverantör:** SEB Kort Bank AB
- **Supplier number:** `2440001565061`
- **Period:** `2025-05-01` till `2026-05-31`
- **Förväntat antal månadsavräkningar:** ~24 (två kortserier × 12 månader)
- Varje månadsavräkning är en `fortnox_get_supplier_invoice` med endast två konteringsrader (2440 ↔ 2880). De individuella transaktionerna finns i **PDF-bilagan** kopplad via `fortnox_list_supplier_invoice_files`.

## Pipeline

### Steg 1 — Lista alla SEB-fakturor

```
fortnox_list_supplier_invoices(
  supplier_number="2440001565061",
  from_date="2025-05-01",
  to_date="2026-05-31",
  fetch_all=true,
  response_format="json"
)
```

Spara: `given_number`, `invoice_number`, `invoice_date`, `total` per faktura.

### Steg 2 — För varje faktura, hämta PDF

```
fortnox_list_supplier_invoice_files(supplier_invoice_number="<given_number>")
→ file_id för PDF-bilagan

fortnox_download_archive_file(file_id="<file_id>")
→ structuredContent.base64 (Claude Code sparar automatiskt om payloaden är stor;
   leta efter "Output has been saved to ..." och använd den sökvägen)
```

### Steg 3 — Decode + extrahera text

```bash
# Om Claude Code sparat output:
jq -r '.base64' "$SAVED_TOOL_RESULT_PATH" | base64 -d > /tmp/seb-<given_number>.pdf

# Om du fick base64 inline:
echo "$BASE64" | base64 -d > /tmp/seb-<given_number>.pdf

pdftotext -layout /tmp/seb-<given_number>.pdf -
```

### Steg 4 — Parse PDF-texten till strukturerade transaktioner

Varje transaktion i PDF:en följer det här mönstret (exempel):

```
Inköpsställe: WWW.MAILERLITE.COM, Stad:                 1,00 st    1 968,91     1 968,91
DUBLIN, Kortinnehavare: NORELL-HUSSEIN DAVID
Inkluderat Momsbelopp: 0.00 SEK
Transaktionsdatum: 2025-05-12
Ursprungligt belopp: 176.00 EUR
Växelkurs: 11.186989
```

Extrahera per transaktion:

| Fält | Källa i PDF |
|---|---|
| `inkopsstalle` (rå leverantörssträng) | "Inköpsställe: …" före komma |
| `stad` | "Stad: …" före komma |
| `kortinnehavare` | "Kortinnehavare: …" till radslut |
| `belopp_sek` | sista kolumnen (Belopp) |
| `transaktionsdatum` | "Transaktionsdatum: YYYY-MM-DD" |
| `ursprungligt_belopp` | "Ursprungligt belopp: X.XX VAL" |
| `ursprungs_valuta` | (samma rad — sista token) |
| `vaxelkurs` | "Växelkurs: X.XXXXXX" |
| `momsbelopp` | "Inkluderat Momsbelopp: X.XX SEK" |
| `faktura_given_number` | (kontext — vilken månadsfaktura) |

Tips: parsing är robustast om du läser PDF-texten **rad för rad i ett pass** och samlar fält tills nästa "Inköpsställe:" dyker upp = ny transaktion.

### Steg 5 — Normalisera leverantör

Den råa `inkopsstalle`-strängen är ofta otydlig (`BKG*HOTEL AT BOOKING.C`, `WWW.MAILERLITE.COM`, `SJ APP`, `OPENAI*OPENAI.COM/CHARGE`…).

Producera en `leverantor_normaliserad`-kolumn där du:
- Tar bort prefix som `WWW.`, `BKG*`, `PAYPAL *`, `SQ *`, `SP *`, `IZ *`, etc.
- Slår ihop varianter (`OPENAI`, `OPENAI.COM`, `OPENAI*CHARGE` → "OpenAI")
- Markerar oklart med `?` (t.ex. "OKÄND BKG*XYZ123" → flagga senare)

Lista alla unika `leverantor_normaliserad` innan du kategoriserar — visa mig listan så jag kan godkänna/justera mappningen.

### Steg 6 — Kategorisera

Föreslå dessa kategorier (men presentera leverantörslistan först, kategorisera sen efter mitt godkännande):

| Kategori | Typiska leverantörer |
|---|---|
| **SaaS — utveckling** | GitHub, Vercel, AWS, Cloudflare, Linear, Notion, Figma |
| **SaaS — kommunikation/produktivitet** | Slack, Notion, Google Workspace, Microsoft 365, Loom |
| **SaaS — marknadsföring** | MailerLite, Mailchimp, ConvertKit, Buffer, Hootsuite |
| **AI** | OpenAI, Anthropic, Claude, ElevenLabs, Midjourney, Perplexity |
| **Marknadsföringsannons** | Meta Ads, Google Ads, LinkedIn Ads, TikTok Ads |
| **Resor** | SJ, Flygbolag, Booking.com, Hotels.com, taxi |
| **Representation/mat** | Restauranger, catering, Wolt, Foodora |
| **Kontorsmaterial/fysiska köp** | IKEA, Webhallen, Office Depot |
| **Bank/avgifter** | Kortavgifter, växlingsavgifter |
| **Övrigt — okänd** | Allt annat — kräver manuell genomgång |

### Steg 7 — Bygg de tre vyerna

Skapa **Google Sheet i Charmas Drive** (eller skapa `.xlsx` om Drive inte är konfigurerad), döpt:
**"SEB Kort genomgång maj 2025 – maj 2026"**

#### Flik 1 — "Per leverantör"

| Kolumn |
|---|
| `leverantor_normaliserad` |
| `kategori` |
| `antal_debiteringar` |
| `total_sek` (12 mån) |
| `snitt_per_manad_sek` |
| `forsta_debitering` (datum) |
| `senaste_debitering` (datum) |
| `kortinnehavare_lista` (komma-separerad om flera) |
| `agare` (tom kolumn för manuell ifyllning) |
| `beslut` (tom: Behåll/Säg upp/Granska) |
| `kommentar` (tom) |

Sortera fallande på `total_sek`.

#### Flik 2 — "Transaktioner"

En rad per kortdebitering, alla fält från Steg 4 + `leverantor_normaliserad` + `kategori`. Sortera kronologiskt.

#### Flik 3 — "Flaggade"

Filtrera/dubbletter:
- **Engångsköp**: `antal_debiteringar = 1` på 12 mån
- **Misstänkta dubbletter**: samma `leverantor_normaliserad` + `belopp_sek` + `transaktionsdatum`
- **Okänd kategori**
- **Stort engångsbelopp**: enskild transaktion > 10 000 SEK utan månadsmönster
- **Valuta-avvikelser**: ursprungsvaluta ≠ SEK (kontrollera växelkurs är rimlig)

### Steg 8 — Sanity check (kör innan leverans)

För varje SEB-faktura: **summa av extraherade transaktioner ska matcha `total` från `fortnox_list_supplier_invoices`** (öre-precision).

Om en faktura avviker > 1 öre — logga det och visa mig, gå inte vidare innan du har förklaring (vanligaste orsaker: avgifter i PDF som inte är "transaktioner" per se, eller PDF-parsing missade en rad).

### Steg 9 — Generera treemap-visualisering

Som komplement till Sheetet — bygg en **enstaka, fristående HTML-fil** med en interaktiv treemap (kategori → leverantör, klick för drill-down, storlek = belopp).

```python
# Python 3 + plotly. Installera om saknas: pip install plotly pandas
import pandas as pd
import plotly.express as px

# transactions = lista med dicts från Steg 4-6 (en rad per debitering)
df = pd.DataFrame(transactions)

# Aggregera per leverantör för treemap-vyn (annars blir det 100-tals små rutor)
agg = df.groupby(['kategori', 'leverantor_normaliserad'], as_index=False).agg(
    total_sek=('belopp_sek', 'sum'),
    antal=('belopp_sek', 'count'),
)

fig = px.treemap(
    agg,
    path=[px.Constant('SEB Kort 2025–2026'), 'kategori', 'leverantor_normaliserad'],
    values='total_sek',
    color='kategori',
    hover_data={'total_sek': ':,.0f', 'antal': True},
    title='SEB Kort genomgång — maj 2025 till maj 2026',
)
fig.update_traces(
    textinfo='label+value',
    texttemplate='<b>%{label}</b><br>%{value:,.0f} kr',
)
fig.update_layout(margin=dict(t=50, l=10, r=10, b=10))
fig.write_html('/tmp/seb-kort-treemap.html', include_plotlyjs='cdn')
```

Ladda upp `seb-kort-treemap.html` till **samma Drive-mapp som Sheetet**. Single file (~50 KB), öppnas i webbläsare, ingen hosting krävs.

### Steg 10 — Leverera

- Dela Google Sheet-länken
- Dela HTML-treemap-länken (eller embed-kod om den ska in i Notion-sidan)
- Sammanfatta i chatten:
  - Totalt antal transaktioner
  - Totalt belopp
  - Top-10 leverantörer (belopp)
  - Antal som flaggades och varför
  - Eventuella faktura-summor som inte matchade (om några)

## Vad du INTE ska göra

- Skicka aldrig Client Secret, JWT, eller refresh tokens i klartext
- Skapa inga supplier-, kund-, eller voucher-poster i Fortnox (alla MCP-tools du behöver är read-only)
- Publicera inte Sheet-länken offentligt — håll den privat inom Charma-orgen i Drive

## När du fastnar

- **PDF parsar konstigt på en specifik faktura** → spara PDF:en, fortsätt med resten, rapportera vilken
- **list_files returnerar 0 files för någon faktura** → flagga den och fortsätt — vissa fakturor kan sakna PDF
- **Något 403:ar** → mycket osannolikt, men säg till så fixar vi scopes i FORTNOX_SCOPES env var
- **Du behöver fler scopes/tools** → MCP-koden ligger på `Charma-API/fortnox-mcp`, prata med Jonas

---

Sätt igång med Steg 1 och rapportera 24 fakturor innan du går vidare.

---

# Fas 2 — Bred leverantörsgenomgång från 2025-09-01

**Starta först när Fas 1 (SEB Kort-genomgången) är levererad och godkänd av Jonas.**

## Syfte

Hitta **besparingsmöjligheter**, **felaktigheter** och **avvikelser** i Charmas leverantörskostnader från `2025-09-01` till idag. Annan scope än Fas 1 — här är det inte specifikt SEB-kortköp utan **alla leverantörer** Charma har bokfört fakturor från under perioden.

⚠️ Volym: troligen 2 000–3 000 leverantörsfakturor. Du behöver INTE ladda ner PDF för varje — bara för outliers du behöver förstå djupare. De flesta fakturor är redan tillräckligt itemiserade i `fortnox_get_supplier_invoice`-radernas konton+belopp.

## Pipeline

### Steg A — Hämta alla fakturor

```
fortnox_list_supplier_invoices(
  from_date="2025-09-01",
  to_date="<today>",
  fetch_all=true,
  response_format="json"
)
```

Spara per faktura: `given_number`, `supplier_number`, `supplier_name`, `invoice_date`, `due_date`, `total`, `balance`, `currency`, `booked`, `cancelled`, `status`.

### Steg B — Aggregera per leverantör

För varje unik kombination av `supplier_number` (och `supplier_name`):

| Fält |
|---|
| `supplier_number` |
| `supplier_name` |
| `antal_fakturor` |
| `total_sek` (12 mån ekvivalent — räkna om om perioden är kortare för ny leverantör) |
| `total_efter_periodisering` (faktiskt utgift under perioden, inte annualiserad) |
| `snitt_per_faktura_sek` |
| `forsta_faktura` (datum) |
| `senaste_faktura` (datum) |
| `obetalt_sek` (`status="unpaid"` / `balance > 0`) |
| `valutor` (lista över unika currencies) |
| `kontering_dominerar` (vilket kostnadskonto används mest — ger en första kategoriserings-hint) |
| `kategori` (se nedan) |

För kontering: dra ut konteringskonton från de översta 3–5 största fakturorna per leverantör (`fortnox_get_supplier_invoice`) och titta efter dominanta debit-konton (3000–8000-serien). Skippa fakturor som bara har 2440↔2880 (SEB-kort) — där är leverantörsraden inte informativ utan PDF.

### Steg C — Kategorisera

Använd samma kategorier som Fas 1 + dessa nya som är vanligare hos rena leverantörsfakturor:

| Kategori | Typiska konton (debet) |
|---|---|
| Inköp varor för försäljning | 4000–4099 (inköpskostnader) |
| Frakt/logistik | 4100–4199 |
| Personal — externa konsulter | 6550, 6560 |
| Lokal — hyra | 5010, 5020 |
| Lokal — drift (el, värme, städ) | 5030–5099 |
| Resor — bil/drivmedel | 5610, 5620 |
| Telekommunikation | 6210 |
| IT-drift (servrar, hosting, licenser) | 6540 (men inkluderar även SaaS — granska) |
| Marknadsföring | 5900–5999 |
| Representation | 6071, 6072 |
| Förbrukningsmaterial | 6110, 6230 |
| Försäkring | 6310 |
| Banktjänster + räntor | 6570, 8410 |
| Skatter | 2510, 2640, 2650 — egentligen balansposter, flagga om de syns ovanligt |
| Övrigt — okänd | (manuell granskning) |

Visa mig listan med Top-30 leverantörer + kategori + kontering INNAN du går vidare till Steg D. Jag granskar och säger till om kategoriseringen behöver justeras.

### Steg D — Hitta besparingsmöjligheter

Producera en lista med kandidater. För varje: motivering, ungefärlig besparing per år, och konkret nästa steg.

Leta efter:

1. **Dubbel-leverantörer för samma sak**
   - T.ex. både Mailchimp och MailerLite för email
   - Både GitHub och GitLab
   - Flera projektlednings-SaaS (Asana + Linear + Jira)
   - Flera AI-prenumerationer (OpenAI + Anthropic + Perplexity) — kan vara legit, men flagga för granskning
2. **Ovanligt stigande månadssumma** — leverantörer där `total_efter_periodisering / antal_månader_aktiv` har ökat > 30 % senaste 3 mån vs period innan
3. **Stora belopp utan tydlig kategorisering** — > 50 000 SEK årstakt mot "Övrigt — okänd"
4. **Engångskonsulter med upprepade fakturor** — leverantör som ser ut som engångskonsult (bara namn, ingen organisationsstruktur i bokföringen) men dyker upp fler än 3 ggr — bör formaliseras
5. **SaaS med lågt utnyttjande-signal** — domäner som *.com med < 500 SEK/månad, ofta glömda
6. **Hög växelkurs-spread** — utlands-leverantörer där kursförluster är signifikanta, kan bytas mot SEK-baserad konkurrent eller hedgas

### Steg E — Hitta felaktigheter och anomalier

Producera en lista med poster att granska. Per post: faktura/leverantör, vad som ser fel ut, föreslagen åtgärd.

Leta efter:

1. **Misstänkta dubbla fakturor**
   - Samma `supplier_number` + samma `total` + `invoice_date` inom 7 dagar
   - Liknande `invoice_number` (t.ex. 100, 100A)
2. **Konteringsavvikelser**
   - Leverantör vars typiska kontering plötsligt skiftar (t.ex. en SaaS-leverantör bokförs mot 4000 istället för 6540)
   - Konto för representation > 6072-gräns (avdragsförbud)
3. **Sena betalningar / förfallna**
   - `status="unpaidoverdue"` med belopp > 0 efter förfallodatum
4. **Saknade PDF-bilagor**
   - `fortnox_list_supplier_invoice_files` returnerar 0 filer för fakturor > 5 000 SEK
   - Flagga för manuell uppladdning eller arkivkontroll
5. **Valuta-avvikelser**
   - Faktura där `currency != "SEK"` men ingen växelkurs/utländsk belopp finns dokumenterat
   - Växelkurs som avviker > 5 % från Riksbankens snittkurs för datumet (om du har möjlighet att verifiera)
6. **OCR/fakturanummer-luckor**
   - Samma leverantör där fakturanummer-serie har glapp (förvänta löpande numrering — luckor kan tyda på saknad faktura eller dubbelt-registrering)
7. **Momsavvikelser**
   - Faktura med VAT-nr utanför Sverige men full svensk moms bokförd, eller tvärtom
8. **Beloppen för annorlunda**
   - Faktura > 200 % av leverantörens normal-snittfaktura — kontrollera om det är legit (årsavtal vs månad), missförstånd, eller fel
9. **Inaktiva leverantörer som plötsligt återaktiverats**
   - Leverantör som inte haft fakturor på > 6 månader och plötsligt får en (kan vara legit, men värt en flagga)

### Steg F — Generera treemap-visualisering

Bygg en HTML-treemap med tre nivåer för att navigera 2-3k fakturor över 200+ leverantörer effektivt.

```python
import pandas as pd
import plotly.express as px

# invoices = lista med dicts från Steg A (rådata per faktura)
df = pd.DataFrame(invoices)

# Berika med kategori (från Steg C-aggregatet) och anomali-flagga (från Steg E)
df = df.merge(supplier_categorization[['supplier_number', 'kategori']], on='supplier_number', how='left')
df['anomali'] = df['given_number'].isin(anomalies_set)  # set från Steg E

# Aggregera per leverantör för treemap-rutnivå
agg = df.groupby(['kategori', 'supplier_name'], as_index=False).agg(
    total_sek=('total', 'sum'),
    antal_fakturor=('given_number', 'count'),
    obetalt_sek=('balance', 'sum'),
    har_anomali=('anomali', 'any'),
)
agg['fargkod'] = agg['har_anomali'].map({True: 'Anomali', False: 'OK'})

fig = px.treemap(
    agg,
    path=[px.Constant('Leverantörer sep 2025+'), 'kategori', 'supplier_name'],
    values='total_sek',
    color='fargkod',
    color_discrete_map={'OK': '#7BAE7B', 'Anomali': '#D9534F', '(?)': '#999999'},
    hover_data={
        'total_sek': ':,.0f',
        'antal_fakturor': True,
        'obetalt_sek': ':,.0f',
    },
    title='Charma leverantörsgenomgång — sep 2025 till idag',
)
fig.update_traces(
    textinfo='label+value',
    texttemplate='<b>%{label}</b><br>%{value:,.0f} kr',
)
fig.update_layout(margin=dict(t=50, l=10, r=10, b=10))
fig.write_html('/tmp/leverantorer-treemap.html', include_plotlyjs='cdn')
```

Treemap-färgkodningen: **röd** = leverantör har minst en flaggad anomali, **grön** = ren. Bra "först-titta-där"-signal för granskning.

För extra djupdyk-fil: skapa **en till** treemap där `path` istället är `['kategori', 'konto', 'supplier_name']` (med kontering från Steg B). Den visar var pengarna flödar i kontoplan-strukturen, vilket är värdefullt för bokföring/revisions-perspektiv. Filnamn: `leverantorer-treemap-konto.html`.

### Steg G — Leverera

Skapa ett **separat** Google Sheet, döpt:
**"Leverantörsgenomgång sep 2025 – <senaste-fakturadatum>"**

Med fem flikar:

1. **"Per leverantör"** — aggregat enligt Steg B, sorterat fallande på `total_efter_periodisering`
2. **"Topp 50 — drilldown"** — för de 50 största: alla fakturor radvis, så ni kan granska
3. **"Besparingar"** — lista från Steg D + ungefärlig årseffekt + nästa steg
4. **"Anomalier"** — lista från Steg E + förslag på åtgärd
5. **"Sanity check"** — för perioden: totalsumma fakturor, totalsumma per kategori, antal leverantörer, varav nya/inaktiverade. Inkludera matchning mot resultaträkningens externa kostnader om den datan är tillgänglig via `fortnox_account_activity` (4000–8000-serien för samma period).

Ladda upp **båda treemap-HTML-filerna** (`leverantorer-treemap.html` + `leverantorer-treemap-konto.html`) i samma Drive-mapp som Sheetet.

I chatten — kort sammanfattning:
- Totalvolym (kr + antal fakturor + antal leverantörer)
- Top 3 besparingsförslag med uppskattad effekt
- Top 3 anomalier som kräver omedelbar granskning
- Eventuella datakvalitetsfynd (sakande PDFer, konteringsfel, etc.)
- Länkar till båda treemap-filerna

## Vad du INTE ska göra i Fas 2

- Föreslå besparingar utan motivering eller ungefärligt belopp
- "Generalisera" från enstaka fakturor till påståenden om hela kategorier
- Påstå att en leverantör är dyr utan att jämföra mot deras kategori-baseline
- Föreslå avtalsbrott eller uppsägningar — det är ledningsbeslut, inte AI-beslut. Du föreslår granskning.
- Glömma att fortfarande behandla data som intern känslig

---

När både Fas 1 (SEB Kort) och Fas 2 (bred leverantörsgenomgång) är levererade — sammanfatta i en kort statusrapport: vad som har gjorts, vad som väntar på ägar-tilldelning, vad som rekommenderas för uppföljning på nästa ledningsmöte.
