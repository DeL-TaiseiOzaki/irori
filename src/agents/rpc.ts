import type { ChildProcess } from 'node:child_process';
import { JsonLineConnection } from './json-lines';
// Protocol JSON is validated by the provider. Unrecognized requests fail closed.
export type Message = {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string; code: number };
};
export class Rpc {
  private connection: JsonLineConnection;
  constructor(
    child: ChildProcess,
    incoming: (message: Message) => void,
    failure: (error: Error) => void = () => {},
  ) {
    this.connection = new JsonLineConnection(
      child,
      (message: Message) => {
        if (message.id !== undefined && !message.method)
          this.connection.accept(message.id, message.result, message.error?.message);
        else incoming(message);
      },
      failure,
    );
  }
  send(message: Message) {
    this.connection.send(message);
  }
  request(method: string, params: unknown): Promise<any> {
    return this.connection.request({ method, params }, 45000, true);
  }
  fail(error: Error) {
    this.connection.fail(error);
  }
}
