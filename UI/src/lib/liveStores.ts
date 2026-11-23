import { createContext, useContext } from 'react';
import { KeyedLog } from './stores';
import type { ChargerEvent, OcppLogEntry } from './types';

// Live data that does not live in the query cache: the OCPP frames and the
// logbook entries of each charger, and whether the backend link is up.

export const logStore = new KeyedLog<OcppLogEntry>(600);
export const eventStore = new KeyedLog<ChargerEvent>(300);

export const BackendContext = createContext(false);

/** Is the live link to the emulator backend up? */
export const useBackendOnline = () => useContext(BackendContext);
