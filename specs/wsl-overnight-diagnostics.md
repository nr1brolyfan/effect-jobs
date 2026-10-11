# WSL overnight diagnostics

## Cel

Ustalić, dlaczego nocna praca agentów została przerwana. Ostatni dostępny wpis
Linuksa był około 05:17 czasu lokalnego 2026-10-05; nie jest to potwierdzona
godzina awarii. Dostępne logi Windows nie potwierdziły odpowiadającego jej
uśpienia, restartu ani błędu Hyper-V. Komputer nie obsługuje Modern Standby.
Nie ma dowodu, że przyczyną było wygaszenie ekranu lub zmiana wykonana przez agenta.

## Co oznacza heartbeat

Heartbeat to mały wpis „nadal działam”, dopisywany co minutę do lokalnego pliku.
Nie uruchamia modelu AI ani zadania Multica. Zapisujemy czas UTC, numer kolejnego
wpisu oraz identyfikator uruchomienia monitora, żeby rozpoznać przerwę lub restart.

## Plan na kolejną noc

- Uruchomić dwa niezależne monitory: jeden w Windows, drugi wewnątrz WSL.
  Monitor Windows nie może zależeć od działającego WSL.
- Każdy dopisuje heartbeat do osobnego pliku co 60 sekund. Monitory mają skończony
  czas działania, np. 8 godzin, i ograniczony rozmiar logów.
- Po braku heartbeat WSL przez co najmniej 3 minuty monitor Windows zapisuje
  stan dystrybucji (`wsl --list --verbose`) oraz istotnych procesów hosta.
  Każdy odczyt ma timeout, np. 10 sekund; zawieszony odczyt nie zatrzymuje monitora.
- Osobno sprawdzać stan daemonów Multica/OpenCode, z timeoutami i bez tworzenia
  nowych wykonań agentów. Diagnostykę WSL zebrać przy kolejnym wystąpieniu problemu.
- Nie restartować automatycznie WSL ani usług: restart może zatrzeć ślady.
  Nie zmieniać ustawień zasilania bez dowodów. Nie zapisywać sekretów, promptów
  ani treści projektów; wystarczą czasy, identyfikatory, statusy i błędy odczytu.

## Jak interpretujemy wynik

| Obserwacja | Co sprawdzamy dalej |
| --- | --- |
| Przerwa w obu heartbeat | Host Windows, jego zasilanie albo zatrzymanie monitorów |
| Windows zapisuje, WSL nie | WSL/VM albo monitor Linuksa |
| Oba zapisują, agenci nie pracują | Multica/OpenCode, kolejki, sieć i zależności zadań |

Heartbeat zawęża czas i obszar problemu, ale sam nie dowodzi jego przyczyny.
Przerwę należy zestawić z logami systemowymi i identyfikatorami uruchomień.

**Status:** plan diagnostyczny zapisany; monitory nie zostały jeszcze
zaimplementowane ani uruchomione. Sam dokument nie wdraża monitoringu.
