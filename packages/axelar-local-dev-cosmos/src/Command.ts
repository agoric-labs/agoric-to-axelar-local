"use strict";

import { ethers } from "ethers";
const { defaultAbiCoder, arrayify } = ethers.utils;
import { CallContractArgs, RelayData } from "@axelar-network/axelar-local-dev";
import { decodeVersionedPayload } from "./utils";
import { CosmosClient } from "./clients";
import { toAccAddress } from '@cosmjs/stargate/build/queryclient/utils';
import {
  ConfirmGatewayTxRequest as EvmConfirmGatewayTxRequest,
} from '@axelar-network/axelarjs-types/axelar/evm/v1beta1/tx';

//An internal class for handling axelar commands.
export class Command {
  commandId: string;
  name: string;
  data: any[];
  encodedData: string;
  post: ((options: any) => Promise<any>) | undefined;

  constructor(
    commandId: string,
    name: string,
    data: any[],
    dataSignature: string[],
    post: (wasmClient: CosmosClient) => Promise<any>,
    chain: string | null = null
  ) {
    this.commandId = commandId;
    this.name = name;
    this.data = data;
    this.encodedData =
      chain === "wasm" && name === "approve_contract_call"
        ? ""
        : defaultAbiCoder.encode(dataSignature, data);
    this.post = post;
  }

  static createWasmContractCallCommand = (
    commandId: string,
    relayData: RelayData,
    args: CallContractArgs
  ) => {
    return new Command(
      commandId,
      "approve_contract_call",
      [
        args.from,
        args.sourceAddress,
        args.destinationContractAddress,
        args.payloadHash,
        args.payload,
      ],
      [],
      async (wasmClient: CosmosClient) => {
        const { argNames, argValues, methodName } = decodeVersionedPayload(
          args.payload
        );
        
        const { client } = wasmClient;
        const senderAddress = wasmClient.getOwnerAccount();
        
        const msg = {
          [methodName]: {
            [argNames[0]]: argValues[0],
            [argNames[1]]: argValues[1],
            [argNames[2]]: argValues[2],
          },
        };
        
        const getConfirmGatewayTxPayload = (sender: string, chain: string, txHash: string) => {
          return [
            {
              typeUrl: `/axelar.evm.v1beta1.ConfirmGatewayTxRequest`,
              value: EvmConfirmGatewayTxRequest.fromPartial({
                sender: toAccAddress(sender),
                chain,
                txId: arrayify(txHash),
              }),
            },
          ];
        }
        const payload = getConfirmGatewayTxPayload(senderAddress, args.from, args.transactionHash);
        console.log(payload);
        const tx = await client.signAndBroadcast(
          senderAddress,
          payload,
          "auto",
          // senderAddress,
          // args.destinationContractAddress,
          // msg,
          // "auto",
          // "call_contract: evm_to_wasm",
          // [{ amount: "100000", denom: wasmClient.chainInfo.denom }]
        );
        console.log(tx);
        relayData.callContract[commandId].execution = tx.transactionHash;

        return tx;
      },
      "wasm"
    );
  };
}
