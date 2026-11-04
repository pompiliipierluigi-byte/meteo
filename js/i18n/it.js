// Testi dell'interfaccia in italiano. Unico punto da cui l'app prende le stringhe.

export const it = {
  app: {
    title: 'Meteo Adriatico',
  },
  disclaimer: {
    // Incrementare `version` quando cambia il testo: l'avviso verrà richiesto di nuovo.
    version: 1,
    title: 'Solo pianificazione',
    body: 'Questa app fornisce stime basate su modelli meteorologici e sulle polari che hai inserito. '
      + 'Le previsioni possono essere sbagliate, la linea di costa è semplificata e non sono considerati '
      + 'fondali, ostacoli, correnti, traffico, zone vietate o condizioni locali. Usala solo per pianificare. '
      + 'Le decisioni in mare spettano allo skipper, sulla base dei bollettini ufficiali e delle carte nautiche.',
    accept: 'Ho capito',
    bar: 'Solo pianificazione — non usare per la navigazione',
    showAgain: 'Leggi l\'avviso',
  },
  menu: {
    open: 'Apri il menu',
    close: 'Chiudi il menu',
    title: 'Livelli e opzioni',
    basemap: 'Mappa base',
    overlays: 'Sovrapposizioni',
  },
  map: {
    carto: 'CARTO chiara',
    osm: 'OpenStreetMap',
    openseamap: 'OpenSeaMap (segnalamenti)',
  },
  model: {
    title: 'Modello',
    auto: 'Auto (ICON-2I fino a 72 h, poi ECMWF)',
    icon2i: 'ICON-2I (ItaliaMeteo-ARPAE, 2 km)',
    ecmwf: 'ECMWF IFS (9 km)',
    gfs: 'GFS (0.25°)',
    run: 'run',
    refresh: 'Aggiorna i dati meteo',
    autoSwitch: 'Da qui ECMWF',
  },
  layers: {
    wind: 'Vento',
    windField: 'Campo colorato (intensità)',
    windArrows: 'Frecce',
    windParticles: 'Particelle animate',
    opacity: 'Opacità campi colorati',
  },
  time: {
    label: 'Ora della previsione',
    minusDay: '−1 giorno',
    minusHour: '−1 ora',
    plusHour: '+1 ora',
    plusDay: '+1 giorno',
    play: 'Avvia animazione',
    pause: 'Ferma animazione',
    now: 'ora',
  },
  notice: {
    loading: 'Scarico {label}: {done}/{total} punti…',
    loadingStart: 'Carico i dati meteo…',
    error: 'Dati meteo non disponibili: {msg}',
    quota: 'Limite di richieste Open-Meteo raggiunto: riprova più tardi.',
    stale: 'Aggiornamento non riuscito: mostro i dati scaricati il {date}.',
    close: 'Chiudi',
  },
  attribution: {
    osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)',
    carto: '© <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    openseamap: 'Segnalamenti © <a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a> contributors',
    openmeteo: 'Meteo: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0) — ICON-2I ItaliaMeteo-ARPAE, ECMWF IFS, NOAA GFS; onda: Open-Meteo Marine',
  },
};
