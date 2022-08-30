import * as jspb from "google-protobuf";

export class DynamicMessage<T> extends jspb.Message { 
  getName(): string;
  setName(value: string): DynamicMessage<T>;

  hasToken(): boolean;
  clearToken(): void;
  getToken(): string | undefined;
  setToken(value: string): DynamicMessage<T>;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DynamicMessage.AsObject<T>;
  static toObject(includeInstance: boolean, msg: DynamicMessage<T>): DynamicMessage.AsObject<T>;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: DynamicMessage<T>, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DynamicMessage<T>;
  static deserializeBinaryFromReader(message: DynamicMessage<T>, reader: jspb.BinaryReader): DynamicMessage<T>;
}

export namespace DynamicMessage {
  export type AsObject<T> = T
}
