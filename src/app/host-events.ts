import { eventHub } from '../domain/event-hub';

/** The host's events, received once across the bridge however many parts listen. */
export const hostEvents = eventHub(window.irori);
