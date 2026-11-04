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
};
