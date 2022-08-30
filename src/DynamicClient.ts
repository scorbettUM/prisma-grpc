import { Field, Root, Type, Message, Service, Method } from 'protobufjs';
import { Client, makeGenericClientConstructor, loadPackageDefinition, Server, GrpcObject, ServerCredentials, UntypedServiceImplementation, ServerUnaryCall, sendUnaryData, ServerReadableStream, ServerWritableStream, UntypedHandleCall, MethodDefinition, ServerDuplexStream  } from '@grpc/grpc-js';
// import { UnaryCallback } from '@grpc/grpc-js/build/src/client';
import { fromJSON } from '@grpc/proto-loader'
import { DynamicMessage } from './DynamicMessage'
import deepEqual from 'deep-equal';

type RPCDefinition = {requestType: string, responseType: string}
type RPCMap = {[key: string]: RPCDefinition}


type RPCProtobuf<T> = {name: string, data: T}
type Call<C> = C extends UnaryCall<infer T, infer K> ? UnaryCall<T, K> : C extends ClientStream<infer T, infer K> ? ClientStream<T, K> : C extends ServerStream<infer T, infer K> ? ServerStream<T, K> : C extends Stream<infer T, infer K> ? Stream<T, K> : any
type RPCCall<C, T, K> = {
    request: RPCProtobuf<T>;
    response: RPCProtobuf<K>;
    name: string;
    callable(call: C extends UnaryCall<infer T, infer K> ? UnaryCall<T, K> : C extends ClientStream<infer T, infer K> ? ClientStream<T, K> : C extends ServerStream<infer T, infer K> ? ServerStream<T, K> : C extends Stream<infer T, infer K> ? Stream<T, K> : any, callback?: GRPCCallback<K>): void;
    rpcType: RPCCallTypes
}
type RPCCallTypes = "unary" | "clientStream" | "serverStream" | "stream";
type UnaryCall<T, K> = ServerUnaryCall<DynamicMessage<T>, DynamicMessage<K>>;
type ClientStream<T, K> = ServerReadableStream<DynamicMessage<T>, DynamicMessage<K>>;
type ServerStream<T, K> = ServerWritableStream<DynamicMessage<T>, DynamicMessage<K>>;
type Stream<T, K> = ServerDuplexStream<DynamicMessage<T>, DynamicMessage<K>>;
type GRPCCallback<K> = sendUnaryData<K>;
// type Call<C> = ; 



export class DynamicClient {
    private serviceName: string;
    private client?: Client;
    private server?: Server;
    private _serverImplementation: UntypedServiceImplementation = {};
    private root: Root;
    private service: Service;
    // private server: Server;
    private _clientImplementation: {[index: string]: MethodDefinition<any, any>; } = {};
    private rpcDefinitions: RPCMap;

    constructor({ serviceName }: {serviceName: string}){
        
        this.root = new Root();
        // this.root.define(serviceName);
        this.rpcDefinitions = {};

        this.service = new Service(serviceName);
        this.root.add(this.service);
        this.serviceName = serviceName
    }
    
    create<C, T, K>({ rpcCalls, address, credentials }: {rpcCalls: RPCCall<C, T, K>[], address: string, credentials: any}){
        this.loadGRPC({ rpcCalls });
        this.createServer();

        return this.createClient({
            serviceIp: address,
            credentials: credentials
        })
    }

    serve({ address, credentials }: {address: string, credentials: ServerCredentials}){
        this.server?.bindAsync(
            address, 
            credentials,
            (err, port) => {
                if (err) throw err;
                console.log(`Running on port: ${port}`);
                this.server?.start();
        });
    }

    createServer(){

        const resolved = this.root.resolveAll().toJSON()

        const result = fromJSON(resolved);
        const protos = loadPackageDefinition(result);

        const protoItems: {name: string, def: GrpcObject}[] = [];
        for (const protoItem in protos){
            const proto = protos[protoItem] as GrpcObject;
            protoItems.push({
                name: protoItem,
                def: proto
            })
        }
        
        const { service } = protos[this.serviceName] as GrpcObject;

        this.server = new Server();
        this.server.addService(
            service as any,
            this._serverImplementation
        )
    }

    createClient({ serviceIp, credentials }: {serviceIp: string, credentials: any}){
        const Client = makeGenericClientConstructor(this._clientImplementation, this.serviceName);
        this.client = new Client(
            serviceIp,
            credentials
        );
        
        return this.client as Client
    }

    private loadGRPC<C, T, K>({ rpcCalls }: {rpcCalls: RPCCall<C, T, K>[]}){

        for (const call of rpcCalls){
            
            this.addType({
                data: call.request.data,
                name: call.request.name
            });
            
            this.addType({
                data: call.response.data,
                name: call.response.name
            });

            this.rpcDefinitions[call.name] = {
                requestType: call.request.name, 
                responseType: call.response.name
            };
    
            if (this.service.lookup(call.name) === null){
                const rpcMethod = new Method(
                    call.name, 
                    "rpc", 
                    call.request.name, 
                    call.response.name
                );
                this.service.add(rpcMethod);
            }

            this._serverImplementation[call.name] = this.createServerRpc<Call<C>, K>({
                callable: call.callable,
                callType: call.rpcType
            });


            this._clientImplementation[call.name] = this.createClientRpc<T, K>({
                callName: call.name,
                requestType: call.request.name,
                responseType: call.response.name,
                rpcType: call.rpcType
            })

        }
    }

    private createClientRpc<T, K>({ callName, requestType, responseType, rpcType }: {callName: string, requestType: string, responseType: string, rpcType: RPCCallTypes}): MethodDefinition<T, K>{

        let requestStreaming = false;
        let responseStreaming = false;

        if (rpcType === 'clientStream' || rpcType === 'stream'){
            requestStreaming = true;
        }

        if (rpcType === 'serverStream' || rpcType === 'stream'){
            requestStreaming = true;
        }

        return {
            path: callName,
            requestStream: requestStreaming,
            responseStream: responseStreaming,
            requestSerialize: (arg: T) => this._serialize<T>(arg, requestType),
            requestDeserialize: (arg: Buffer) => this._deserialize<T>(arg, requestType),
            responseSerialize: (arg: K) => this._serialize<K>(arg, responseType),
            responseDeserialize: (arg: Buffer) => this._deserialize<K>(arg, responseType)
        }

    }

    private _serialize<T extends Object>(arg: T, path: string){
        return Buffer.from(this.objectToBytes({
            data: arg,
            path: path
        }))
    }

    private _deserialize<K extends Object>(arg: Buffer, path: string): K{
        const message = this.bytesToMessage<Message<K>>({
            data: arg,
            path: path
        })

        return this.messageToObject<Message<K>, K>({
            message
        })
    }

    private createServerRpc<C, K>({ callable, callType }: {callable(call: C, callback?: GRPCCallback<K>): void, callType: RPCCallTypes}){
        
        const callTypes = {
            unary: (call: C, callback: sendUnaryData<K>) => {
                    callable(call, callback);
            },
            clientStream: (call: C, callback: sendUnaryData<K>) => {
                   callable(call, callback);
            },
            serverStream: (call: C) => {
                callable(call);
            },
            stream: (call: C) => {
                callable(call)
            }
        }

        return callTypes[callType] as unknown as UntypedHandleCall;

    }

    private addType<T>({ data, name}: {data: T, name: string}){
        type Data = {[key: string]: any};
        const stack: Data[] = [{data, name: name}];
        let result: Data = data;

        while(stack.length > 0){
            const currentNode = stack.pop() as Data

            let definition = this.objectToDefinition({
                data: currentNode.data,
                name: currentNode.name
            });

            for (const key in currentNode.data){
                if (typeof currentNode.data[key] === 'object' && Array.isArray(currentNode.data[key]) === false){
                    const selected = currentNode.data[key];
                    const subDef = this.objectToDefinition({
                        data: selected,
                        name: key
                    })

                    result[key] = subDef;
                    currentNode.data[key] = subDef.name;

                    stack.push({data: selected, name: key});

                }
                else if (Array.isArray(currentNode.data[key])){
                    for (const idx in currentNode.data[key]){
                        const item = currentNode.data[key][idx];
                        if (typeof item === 'object'){
                            const selected = item[key]
                            const subDef = this.objectToDefinition({
                                data: selected,
                                name: key
                            });
                
                            result[key][idx] = subDef;
                            currentNode.data[key][idx] = subDef.name;
            
                            stack.push({data: selected, name: key});

                        }

                    }
                }

            }
            
            definition = this.objectToDefinition({
                data: currentNode.data,
                name: currentNode.name
            });
            
            if (this.root.lookup(currentNode.name) === null){
                this.addDefinition({
                    definition
                })
            }
        }

        const valid = this.validateSerialization({
            data,
            path: name
        })

        if (valid === false){
            throw 'Error: Serialization failed - Returned representation did not match original.'
        }
    }

    private validateSerialization({ data, path }: {data: Object, path: string}){
        
        const bytes = this.objectToBytes({
            data,
            path
        })

        const message = this.bytesToMessage({
            data: bytes,
            path
        })

        const result = this.messageToObject({
            message,
            path
        });

        return deepEqual(result, data);       
    }


    private objectToDefinition({ data, name }: {data: {[key: string]: any}, name: string}){
        const DynamicType = new Type(name);

        let objectData = data;
        if (Array.isArray(data)){
            objectData = data.at(0);
        }

        let fieldIdx = 1;
        for (const field in objectData){
            const value = data[field];
            const fieldType = this._toType(typeof value, value);
            DynamicType.add(new Field(field, fieldIdx, fieldType.type, fieldType.option));
            fieldIdx += 1;
        }

        return DynamicType;
    }

    private addDefinition({ definition, path }: {definition: Type, path?: string}){

        if (path){
            const type = this.root.lookupType(path);
            type.add(definition);

            const serviceType = this.service.lookupType(path);
            serviceType.add(definition);


        }

        this.service.add(definition);
        this.root.add(definition);
    }

    private objectToBytes({ data, path }: {data: Object, path: string}){
        const type = this.root.lookupType(path);
        type.verify(data);
        return type.encode(data).finish();
    }

    private bytesToMessage<T extends Message>({ data, path }: {data: Uint8Array, path: string}): T{
        const type = this.root.lookupType(path);
        return type.decode(data) as T
    }

    private messageToObject<T extends Object, K>({ message, path }: {message: Message<T>, path?: string}): K{

        const options = {
            longs: Number,
            enums: String,
            bytes: String
        }

        if (path){
            const type = this.root.lookupType(path);
            return type.toObject(message, options) as K
        }

        return message.$type.toObject(message, options) as K;
        
    }

    private _toType(type: string, value: any){

        if (Array.isArray(value)){
            const types = value.map(arrayValue => this._getBaseType(typeof arrayValue, arrayValue));
            const uniqueTypes = new Set(types);
            return {
                type: Array.from(uniqueTypes).pop() as string,
                option: "repeated"
            }
        }

        return {
            type: this._getBaseType(type, value),
            option: undefined
        }
    }

    private _getBaseType(type: string, value: any){
        if (value.name !== undefined){
            return value.name
        }
        
        switch(type){
            case "boolean":
                return "bool"
            case "string":
                return "string"
            case "number":
                return value%1 === 0 ? "int64" : "float"
            default:
                return "bytes"
        }
    }
}

// const dynamicClient = new DynamicClient({
//     serviceName: "Example"
// });

// const test = {Target: [{b: 2}], c: 3}
// type TestType = typeof test;
// type ResponseType = typeof test;

// const client = dynamicClient.create({
//      rpcCalls: [
//          {
//              request: {
//                  name: "TestRequest",
//                  data: test
//              },
//              response: {
//                  name: "TestResponse",
//                  data: test
//              },
//              name: "makeTestRequest",
//              rpcType: "stream",
//              callable: function(call: Stream<TestType, ResponseType>){
//                 call.on('data', (request: TestType) => {
//                     console.log(request)
//                 });

//                 const m = new DynamicMessage<ResponseType>();
//                 call.write(m)
//              }

//          }
//      ],
//      address: 'localhost:9098',
//      credentials: credentials.createInsecure()
// });

// console.log(`Got client - ${client}`)
// dynamicClient.serve({
//     address: 'localhost:9098',
//     credentials: ServerCredentials.createInsecure()
// });