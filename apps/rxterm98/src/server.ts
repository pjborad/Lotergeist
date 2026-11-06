import { createApp } from "./app";

const port = Number(process.env.RXTERM_PORT ?? 4100);
createApp().listen(port, () => console.log(`RxTerm 98 listening on http://localhost:${port}  (user RIV02 / pass GRAVE98)`));
