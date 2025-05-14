"use strict";

import { ethers } from "ethers";
const { defaultAbiCoder } = ethers.utils;
import { CallContractArgs, CallContractWithTokenArgs, RelayData } from "@axelar-network/axelar-local-dev";
import {
  decodeVersionedPayload,
  getConfirmGatewayTxPayload,
  getRouteMessagePayload,
  getVoteRequestPayload,
  getVoteRequestWithTokenPayload,
  incrementPollCounter,
} from "./utils";
import { CosmosClient } from "./clients";

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
      chain === "wasm" && (name === "approve_contract_call" || name === "approve_contract_call_with_mint") 
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
        const { client } = wasmClient;
        const senderAddress = wasmClient.getOwnerAccount();

        // Confirm that event has fired on the EVM chain
        console.log(
          "[Ethereum Relayer]",
          "Confirming Gateway Tx",
          args.transactionHash
        );
        const confirmGatewayTxPayload = getConfirmGatewayTxPayload(
          senderAddress,
          args.from,
          args.transactionHash
        );
        const confirmGatewayTxResponse = await client.signAndBroadcast(
          senderAddress,
          confirmGatewayTxPayload,
          "auto"
        );

        // Vote on the poll created by the axelar (normally done by the validator)
        const pollId = await incrementPollCounter();
        console.log("[Ethereum Relayer]", "Voting on poll", pollId);
        const voteRequestPayload = getVoteRequestPayload(
          wasmClient.getOwnerAccount(),
          args,
          confirmGatewayTxResponse,
          pollId
        );
        const VoteRequestResponse = await wasmClient.client.signAndBroadcast(
          wasmClient.getOwnerAccount(),
          voteRequestPayload,
          "auto"
        );

        // Route the message created by the poll to the destination chain
        const eventId = VoteRequestResponse.events
          .find((e: any) => e.type === "axelar.evm.v1beta1.EVMEventConfirmed")
          ?.attributes.find((a: any) => a.key === "event_id")
          ?.value.slice(1, -1);

        if (!eventId) {
          throw new Error("Event ID not found in EVMEventConfirmed event");
        }

        console.log("[Ethereum Relayer]", "Routing event", eventId);
        const routeMessagePayload = getRouteMessagePayload(
          wasmClient.getOwnerAccount(),
          args,
          eventId
        );
        const routeMessageResponse = await wasmClient.client.signAndBroadcast(
          wasmClient.getOwnerAccount(),
          routeMessagePayload,
          "auto"
        );
        console.log(
          "[Ethereum Relayer]",
          "Event routed to agoric",
          routeMessageResponse.transactionHash
        );

        relayData.callContract[commandId].execution =
          routeMessageResponse.transactionHash;

        return routeMessageResponse;
      },
      "wasm"
    );
  };
  static createWasmContractCalWithTokenCommand = (
    commandId: string,
    relayData: RelayData,
    args: CallContractWithTokenArgs
  ) => {
    return new Command(
      commandId,
      "approve_contract_call_with_mint",
      [
        args.from,
        args.sourceAddress,
        args.destinationContractAddress,
        args.payloadHash,
        args.destinationTokenSymbol,
        args.amountOut,
        args.payload,
      ],
      [],
      async (wasmClient: CosmosClient) => {
        const { client } = wasmClient;
        const senderAddress = wasmClient.getOwnerAccount();

        // Confirm that event has fired on the EVM chain
        console.log(
          "[Ethereum Relayer]",
          "Confirming Gateway Tx",
          args.transactionHash
        );
        const confirmGatewayTxPayload = getConfirmGatewayTxPayload(
          senderAddress,
          args.from,
          args.transactionHash
        );
        const confirmGatewayTxResponse = await client.signAndBroadcast(
          senderAddress,
          confirmGatewayTxPayload,
          "auto"
        );

        // Vote on the poll created by the axelar (normally done by the validator)
        const pollId = await incrementPollCounter();
        console.log("[Ethereum Relayer]", "Voting on poll", pollId);
        const voteRequestPayload = getVoteRequestWithTokenPayload(
          wasmClient.getOwnerAccount(),
          args,
          confirmGatewayTxResponse,
          pollId
        );
        const VoteRequestResponse = await wasmClient.client.signAndBroadcast(
          wasmClient.getOwnerAccount(),
          voteRequestPayload,
          "auto"
        );

        // Route the message created by the poll to the destination chain
        const eventId = VoteRequestResponse.events
          .find((e: any) => e.type === "axelar.evm.v1beta1.EVMEventConfirmed")
          ?.attributes.find((a: any) => a.key === "event_id")
          ?.value.slice(1, -1);

        if (!eventId) {
          throw new Error("Event ID not found in EVMEventConfirmed event");
        }

        console.log("[Ethereum Relayer]", "Routing event", eventId);
        const routeMessagePayload = getRouteMessagePayload(
          wasmClient.getOwnerAccount(),
          args,
          eventId
        );
        const routeMessageResponse = await wasmClient.client.signAndBroadcast(
          wasmClient.getOwnerAccount(),
          routeMessagePayload,
          "auto"
        );
        console.log(
          "[Ethereum Relayer]",
          "Event routed to agoric",
          routeMessageResponse.transactionHash
        );

        relayData.callContractWithToken[commandId].execution =
          routeMessageResponse.transactionHash;

        return routeMessageResponse;
      },
      "wasm"
    );
  };
}
