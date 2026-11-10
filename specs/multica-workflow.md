# Multica workflow — effect-jobs

This policy applies exclusively to effect-jobs and changes no other project. Canonical project workflow and roster: UPVE-1020.

Ten dokument opisuje zasady pracy w projekcie effect-jobs. Nie jest raportem bieżącego stanu ani automatyczną autoryzacją uruchomienia backlogu, zmian konfiguracji, pushu, merge, publikacji lub deploymentu. Zakres i uprawnienia konkretnej pracy zapisujemy w projekcie i zadaniu Multica.

## 1. Model i role

**Wszystkie role używają GPT-6.1 Sol z reasoning Medium:** `openai/gpt-6.1-sol#medium`, z jawnym `thinking_level: medium`. Dotyczy to implementora, jednego reviewera, triage i koordynatora. Nie używamy High, innych modeli ani fallbacków.

W Multica używamy runtime **Codex** zamiast OpenCode jako workaround błędów zakończenia streamu. Dla Codex zapis modelu to `gpt-6.1-sol` z osobnym `thinking_level: medium` — ten sam model i reasoning. Zmiana profilu dotyczy kolejnych wykonań; nie przerywamy zdrowych sesji ani nie powtarzamy ukończonych etapów. Workaround nie oznacza naprawy OpenCode.

Każdy projekt ma własny podstawowy roster czterech wielorazowych profili:

| Role        | Responsibility                                                                      |
| ----------- | ----------------------------------------------------------------------------------- |
| Implementor | Implementation, local qualification, handoff and accepted original-author fixes.    |
| Reviewer    | One independent review of the complete frozen integrated diff and real callers.     |
| Triage      | One independent findings-only adjudication when actual findings need resolution.    |
| Coordinator | Scope, ownership, dependencies, review choice, evidence and authorized integration. |

**Profil agenta jest stałą rolą, nie pojedynczym taskiem.** Nowe zadanie oznacza osobne issue i wykonanie, nie nowego agenta nazwanego numerem PR-a. Ten sam profil może obsługiwać kilka niezależnych wykonań, każde z własnym kontekstem i worktree. Konfiguracja concurrency nie jest gwarancją przepustowości hosta.

Nie dokładamy ukrytych reviewerów, dodatkowego final review ani koordynatorów tylko dlatego, że inne wykonanie czeka. Dodatkowa stała rola wymaga rzeczywistej potrzeby i jawnego rozdzielenia odpowiedzialności.

### Nazewnictwo agentów

Stosujemy **`<projekt> · <rola>`**. For this project use the prefix `effect-jobs` and roles `Implementor`, `Reviewer`, `Triage`, `Coordinator`.

Examples: `effect-jobs · Implementor`, `effect-jobs · Reviewer`, `effect-jobs · Coordinator`. Pełne połączone zakresy reviewerów opisujemy w ich instrukcjach/opisach, nie rozbudowujemy nimi nazwy profilu.

Nie dodajemy do nazw modelu, reasoning, numeru issue/PR-a, nazwy funkcjonalności ani fali. „Permissions”, „sessions” i podobne informacje należą do zadań, nie do nazw stałych agentów. Model i reasoning przechowujemy w konfiguracji. Zmiana nazwy istniejącego profilu zachowuje jego ID i historię; nie tworzymy nowego agenta tylko dla nowej nazwy.

## 2. Izolacja projektów i własność pracy

- effect-jobs has its own profiles; do not dispatch or mutate profiles, issues, timers or code from other projects. effect-auth remains a read-only source/consumer unless explicitly authorized; effect-jobs must not depend on it.
- Koordynator przed dispatch sprawdza `project_id`, agenta z rosteru tego projektu, autoryzację, zależności i brak istniejącego równoważnego wykonania.
- Agent pracuje wyłącznie w przypisanym projekcie i repozytorium. Nie zmienia issues, agentów, timerów ani kodu innego projektu. Zależność od innego repo domyślnie oznacza referencję read-only; zapis wymaga osobnej, jawnej autoryzacji.
- Każda implementacja ma izolowany worktree/branch i rozłączną własność plików. Nie przełączamy ani nie nadpisujemy checkoutu właściciela. Nie usuwamy cudzych zmian.
- Wspólne registrary, `package.json`, lockfile, eksporty, migracje i podobne pliki mają jednego właściciela. Inni zgłaszają potrzebną zmianę temu właścicielowi.
- Wybieramy zwykle **3–6 rzeczywiście niezależnych zadań równolegle**. Nie wymuszamy tej liczby, gdy zależności lub ownership wymagają serializacji; nie tworzymy dodatkowego zakresu dla zapełnienia slotów.
- Kontrakty współdzielone ustalamy przed pracą równoległą. Końcową integrację i merge serializujemy, mimo równoległości niezależnych implementacji i reviews.

## 3. Gdzie przechowujemy informacje

| Miejsce                           | Co tam należy                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| System prompt / instrukcje agenta | Krótka, stabilna rola, granica projektu, zasady bezpieczeństwa, aktualny workflow i odsyłacze do źródeł kontekstu.    |
| Projekt Multica                   | Repozytorium, roster, trwałe ograniczenia, autoryzacje i odsyłacze do zaakceptowanych decyzji/specyfikacji.           |
| Opis issue                        | Cel, zakres i wykluczenia, ownership, zależności, snapshot/baseline oraz skończone kryteria akceptacji.               |
| Komentarze i załączniki issue     | Dyskusja, decyzje dla tego zadania, reprodukcje, raporty, logi i handoff.                                             |
| Metadata issue                    | Mały checkpoint: faza, IDs wykonania/raportów, base/head/tree, blocker, następny krok i cursor odebranych wiadomości. |
| Dokumentacja repo                 | Normatywne API, architektura, zaakceptowane decyzje i powtarzalne polecenia testowe.                                  |

### Higiena system promptów

- Prompt pozostaje mały i wielorazowy. Nie kopiujemy do niego całej dokumentacji, transcriptu, backlogu ani kolejnych raportów. Mieści stabilne reguły roli, nie historię projektu.
- Nie umieszczamy w nim konkretnych issue IDs, PR-ów, chwilowych SHAs, faz, wyjątków jednego taska ani list wykonanych testów. Te informacje należą do issue/projektu.
- Przy zmianie zasad **edytujemy kanoniczną treść i usuwamy zastąpione reguły**, zamiast dopisywać kolejne sekcje „override” lub „supersedes”. Zachowujemy jedną aktualną wersję bez sprzeczności.
- Historię zmiany zachowujemy w logu zmian/załączniku Multica, nie w aktywnym promptcie. Przed większym porządkowaniem robimy kopię konfiguracji.
- Koordynator nie przenosi task-specific informacji do promptów innych projektów. Wspólny wzorzec workflow można stosować w różnych rosterach, ale bez ich bieżącego stanu.
- Nowe konteksty wykonania otrzymują konkretny task; nie liczymy na pamięć poprzedniego wykonania tego samego profilu. Zmiana profilu nie jest powodem do restartowania zdrowej sesji.

## 4. Implementacja i lokalna bramka przed pushem

Przed implementacją agent:

1. Czyta **CAŁE `ai-docs/`**, rekursywnie, bez pomijania dokumentów, przykładów i konfiguracji; odnotowuje przeczytane ścieżki. Gdy dokumentacji nie ma lub jest nieczytelna, zgłasza prerequisite zamiast udawać wykonanie.
2. Czyta obowiązujące instrukcje repo, opis projektu/issue, zaakceptowane decyzje i odpowiednie specyfikacje.
3. Potwierdza właściwy projekt, rzeczywisty baseline, izolację worktree, ownership i spełnione zależności.

**Nie używamy płatnego CI jako pierwszego miejsca wykrywania przewidywalnych błędów.** Przed pushem agent sprawdza aktualny workflow CI i uruchamia jego wymagany lokalny odpowiednik na finalnym kodzie, z właściwymi pinami narzędzi. Nie zakłada, że sam focused test zastępuje pełną bramkę.

Lokalna checklista zależy od projektu i aktualnego CI; obejmuje wymagane format/lint, typy i diagnostykę, build, testy, kontrolę opcji/ownership, API/graph, migracje oraz rzeczywiste backendy i installed-artifact checks tam, gdzie wymaga tego workflow. Bramek skryptowych nie pomijamy tylko dlatego, że nie są testem runtime.

- Pierwszy handoff wymaga przejścia całego wymaganego zestawu. Po zmianach powtarzamy bramki dotknięte zmianą; wcześniejsze dowody wykorzystujemy tylko dla niezmienionych kodu, konfiguracji, narzędzi i artefaktów. W razie wątpliwości uruchamiamy daną bramkę ponownie.
- Zmiana lokalnego kodu po testach unieważnia odpowiednie wyniki. Handoff wiąże wyniki z dokładnym head/tree oraz wersjami narzędzi; nie przedstawiamy wyników wcześniejszego checkpointu jako finalnych.
- Gdy wymagana bramka nie przeszła lub nie może zostać lokalnie wykonana, agent nie robi zwykłego pushu „zobaczymy w CI”. Zgłasza dokładny blocker; wyjątek wymaga jawnej decyzji właściciela.
- Reprodukowalną porażkę naprawiamy i sprawdzamy lokalnie przed kolejnym pushem. Nie robimy pustych pushów/rerunów na tym samym błędnym kodzie.
- Lokalne PASS nie gwarantuje hosted PASS: różnice runnera, sieć i flaky tests mogą pozostać. Nie obchodzimy faktycznych wymaganych checks ani nie fałszujemy sukcesu.
- Nie uruchamiamy niepotrzebnie całych macierzy bez istotnej zmiany. Ciężkie buildy/packed checks serializujemy tam, gdzie zasoby tego wymagają, a niezależne testy wykonujemy równolegle.

Implementor przygotowuje PR, jeśli push/PR są autoryzowane; w przeciwnym razie lokalny handoff. Nie wykonuje self-merge. Commity są zgodne z Conventional Commits.

## 5. One independent review, or zero for a narrow low-risk diff

Decide from the COMPLETE final integrated diff, contracts and evidence. Zero review
is allowed ONLY for truly simple editorial documentation or unambiguous test-only
changes with unchanged behavior/contracts and no weakened oracle, negative controls
or gates. Everything else receives ONE independent project Reviewer, including
normative documentation and runtime/API/security/persistence/concurrency changes.
This does not waive local CI, installed/runtime/hosted gates or authorization.

Before dispatch record `no AI review` or Reviewer, rationale and exact base/head/tree
in the issue. For uncommitted work freeze the complete changed/new file inventory
and artifact/diff hashes. Review the complete integrated snapshot once, including
new files, migrations, public declarations and qualification deltas. Follow real
callers and surrounding cross-module flows rather than the author summary.

Build a risk map and trace reachable success/failure/interruption/retry/concurrency
scenarios. Assess public/behavior/error/environment contracts; actual trust
boundaries/privacy/input; transaction ownership, atomic enqueue plus receipts,
deduplication, races, DB-time leases/fencing, bounded recovery, retention and Unknown
outcomes; Effect Scope/resource finalization/cancellation/errors; installed consumers;
actual test oracles/negative controls and final source/runtime/artifact bytes;
consequential DX, complexity and performance. Lenses are not a finding quota.
Evaluate actual import costs without automatic barrel bans; background reference:
<https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/>.

Use current Traits reports to avoid mechanical convention audits. Inspect their
scope/snapshot and unresolved results; challenge them when real behavior disproves
the conclusion. Traits cannot prove runtime correctness, security or test coverage.
Default assessment covers relevant authored TS/TSX/MTS; Markdown/HTML are excluded.
Missing setup/model results, errors, empty/incomplete coverage and unresolved
assessments are not PASS. Preserve raw reports and manual dispositions separately.

No invented malicious trusted callers, security theatre, style blockers or
preference-driven rewrites. Identify contract changes explicitly. Zero findings is
valid; setup failure or incomplete coverage means INCOMPLETE. Separate confirmed
defects, unresolved evidence and optional nonblocking advice.

Each finding needs severity, path/line, violated contract, reachable prerequisites,
exact snapshot, reproduction command/input or deterministic compile/code-path proof,
expected/actual result and impact. State which reproductions ran. No fabricated
proof or dismissal of material unresolved evidence because infrastructure is missing.
The Reviewer is independent of the author and implementation collaborators, read-only,
with no delegation/hidden subreviewers, product edits, approval, merge, push, deploy
or cross-project mutation. Bounded task-owned reproduction fixtures may not change
frozen source/shared inputs. Do not read other reviewer conclusions before reporting.

No second/delta/final review. Reuse complete evidence despite later platform EOF;
resume only an identified unfinished portion. Independent implementations may have
concurrent reviewers, but each diff has only one Reviewer. Existing assigned sessions
finish their old workflow; preserve historical review sets, without retrospective
waivers. Old profiles receive no NEW dispatch; preserve unfinished assignments,
sessions/reports/history. Archive only after complete assignment/run inventories and
actual session/process/tool liveness establish safety; platform failure is insufficient.

## 6. Krytyczny triage i poprawki

Po odebraniu **kompletnego oryginalnego raportu**, jeśli zgłoszono findings do rozstrzygnięcia, koordynator zleca jednemu agentowi triage ich jednorazową, niezależną ocenę findings-only. Nie wysyła implementorowi surowych findings przed triage. Przy braku review lub findings nie uruchamiamy pustego triage tylko dla potwierdzenia; zapisujemy ten wynik i przechodzimy do wymaganych bramek.

Triage nie jest kolejnym blanket audytem. Triage deduplikuje przyczyny, weryfikuje dowody i klasyfikuje zgłoszenia jako accepted/rejected/deferred z uzasadnieniem. Odrzuca false positives, uwagi zbyt nieistotne, overengineering, security theatre i szkodliwe DX. To nie głosowanie ani mechaniczne połączenie raportów; zero zaakceptowanych poprawek jest poprawnym wynikiem.

Tylko accepted findings wracają do **tego samego implementora, issue i gałęzi/PR-a**. Lista jest skończona, z kryteriami weryfikacji. Po poprawkach uruchamiamy oryginalne reprodukcje i dotknięte testy/bramki, **bez kolejnego AI review**. Koordynator sprawdza dowody i integrację; nie staje się dodatkowym reviewerem z nowym blanket audytem.

Nowy rzeczywisty błąd integracji wymaga konkretnej reprodukcji i wąskiej poprawki autora, nie restartu całego pipeline. Nowa, odrębna implementacja może mieć własny cykl, ale nie tworzymy nowego PR-a tylko po to, żeby obejść zasadę jednej rundy.

## 7. Monitoring, zdarzenia i kolejki

**Zakończenia aktywnych etapów obserwujemy co około 30 sekund**, ale tani odczyt stanu nie oznacza nowego wykonania LLM na każdym heartbeatcie.

- Preferujemy istniejące natywne zdarzenia/warunki Multica dla konkretnych wyników: zakończenie taska, gotowy handoff, przejście zależnego issue do wymaganego stanu oraz ukończenie checks PR-a.
- Nie zakładamy, że subskrypcja zdarzeń jednego issue obejmuje dzieci lub cały projekt. Sprawdzamy rzeczywisty scope i używamy właściwego warunku dla zależnego issue.
- Utrzymujemy co najwyżej jeden równoważny watchdog awaryjny dla danego zakresu. Uwzględniamy minimum interwału platformy; nie deklarujemy timera 30 s, jeśli scheduler dopuszcza dopiero 1 min.
- Nie instalujemy nakładających się timerów, pętli sleep w koordynatorze ani nowych wybudzeń dla każdego komentarza, gdy równoważna obsługa już trwa/czeka. Redundantne powiadomienia powinny zostać obsłużone jednym kolejnym przebiegiem, a nie kolejką kilkunastu powtórzeń.
- Koordynator w pierwszej kolejności odbiera **gotowe handoffy i odblokowuje następny etap**, zamiast ponownie skanować całą historię lub tworzyć kolejną fazę planowania.
- Monitoring zaczyna od małego checkpointu i aktywnych zadań. Czyta nowe komentarze od cursora; pełny raport czyta raz. Uwzględnia wszystkie strony IDs, ale nie pobiera w kółko ukończonych historycznych issues bez powodu.
- `in_progress`/`running` w metadata nie jest samodzielnym dowodem pracy. Przed retry/continuation sprawdzamy platform runs, faktyczną aktywność oryginalnej sesji i ostatnie istotne narzędzia. Błąd platformy nie dowodzi zatrzymania writera.
- Gdy sesja jest idle, najpierw odbieramy jej raport. Wznawiamy tego samego autora tylko dla konkretnej nieukończonej bramki; nie robimy confirmation-only runs ani duplikatu zdrowego writera.
- Zapisujemy czas gotowego handoffu, jego odebrania, startu następnego etapu i konkretny blocker, aby mierzyć opóźnienie orkiestracji.
- Na completion lub rzeczywistym owner-only blockerze kończymy zbędne oczekiwania/watchdogi. Nie anulujemy przy tym cudzych zadań ani zdrowych sesji.

Instrukcja „nie twórz duplikatów” nie jest techniczną deduplikacją platformy. Mechanizmy zdarzeń, scalania wybudzeń i kontroli kolejek trzeba rzeczywiście skonfigurować i sprawdzić; nie ogłaszamy ich wdrożenia na podstawie samego prompta.

## 8. Handoff, merge i zamknięcie

Handoff obejmuje: projekt/issue, zakres i wykluczenia, ownership, repo/branch/worktree, dokładne base/head/tree, PR jeśli istnieje, listę przeczytanych docs, komendy i wyniki, artefakty oraz ograniczenia/NotTested/blockery. Nie umieszczamy sekretów, DSN-ów ani prywatnych payloadów w raportach.

Przed merge koordynator potwierdza:

1. Właściwy projekt, autoryzację i skończone kryteria akceptacji.
2. Zapisaną decyzję o zakresie review (również zero) i ukończenie wszystkich wybranych reviews oraz triage, jeśli były findings do rozstrzygnięcia.
3. Zamknięcie accepted findings i lokalne dowody dla finalnego kodu.
4. Integrację z aktualnym target branch, bez utraty zmian innych autorów; testy adekwatne do rzeczywistej delty integracji.
5. Wymagane hosted checks dla właściwego snapshotu — nie wyniki starego headu.
6. Kontrolowany merge przypiętego headu, np. `--match-head-commit`, oraz potwierdzony wynik i merge SHA.

Gotowe niezależne PR-y nie czekają na niezwiązane zadania. Nie rerunujemy tego samego CI bez diagnozy. Nie omijamy branch protection i nie uznajemy lokalnych testów za zgodę na pominięcie wymaganych hosted gates.

Implementację oznaczamy `done` po zweryfikowanej integracji/merge zgodnej z autoryzacją, nie po samym utworzeniu PR-a. Całą dostawę zamykamy dopiero po potwierdzeniu uzgodnionego inventory, wyłączamy jej monitoring i przekazujemy krótki wynik z ograniczeniami. Historyczne raporty zachowujemy.

Publikacja pakietu, produkcyjny deployment i aktywacja kolejnego zakresu wymagają osobnych decyzji. Porządkowanie rosteru zaczynamy od kopii konfiguracji i sprawdzenia aktywnych wykonań/przypisań; zbędne profile archiwizujemy bez kasowania historii.

## 9. Measurement

For the first three REAL future authorized tasks record handoff-ready, review-start,
report and fix-complete timestamps; reviewer/Traits tokens and cost if available;
accepted/rejected findings and later regressions. Record unavailable values honestly.
Do not launch artificial benchmark tasks or promise unmeasured speedups.
