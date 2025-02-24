import { defaultAxelarChainInfo, AxelarRelayerService, startChains } from './index';
import { SigningStargateClient } from '@cosmjs/stargate';
import { encode } from '@metamask/abi-utils';
import ethers from 'ethers';

import {
  evmRelayer,
  createNetwork,
  deployContract,
  relay,
  RelayerType,
} from '@axelar-network/axelar-local-dev';


export const relayDataToEth = async () => {
  // Start both Axelar and Wasm Chains
  // await startChains();

  // Initialize the Axelar Relayer Service with default configuration
  const axelarRelayer = await AxelarRelayerService.create(
    defaultAxelarChainInfo
  );

  const SendReceive = require('../artifacts/src/__tests__/contracts/SendReceive.sol/SendReceive.json');

  const SendReceive2 = require('../artifacts/src/__tests__/contracts/SendReceive2.sol/AxelarMultiCommandExecutor.json');

  const ethereumNetwork = await createNetwork({ name: 'Ethereum' });
  const ethereumContract = await deployContract(
    ethereumNetwork.userWallets[0],
    SendReceive,
    [
      ethereumNetwork.gateway.address,
      ethereumNetwork.gasService.address,
      'Ethereum',
    ]
  );
  
  const middleManContract = await deployContract(
    ethereumNetwork.userWallets[0],
    SendReceive2,
    [
      ethereumNetwork.gateway.address,
      ethereumNetwork.gasService.address,
    ]
  );

  const ibcRelayer = axelarRelayer.ibcRelayer;

  console.log('IBC RELAYER', JSON.stringify(ibcRelayer.srcChannelId));

  const IBC_DENOM_AXL_USDC =
    'ubld';
  // 'ibc/295548A78785A1007F232DE286149A6FF512F180AF5657780FC89C009E2C348F';
  const AMOUNT_IN_ATOMIC_UNITS = '1000000';
  const CHANNEL_ID = ibcRelayer.srcChannelId;
  const DENOM = 'ubld';
  const AXELAR_GMP_ADDRESS =
    'axelar1dv4u5k73pzqrxlzujxg3qp8kvc3pje7jtdvu72npnt5zhq05ejcsn5qme5';

  const signer = ibcRelayer.wasmClient;
  const senderAddress = 'agoric1estsewt6jqsx77pwcxkn5ah0jqgu8rhgflwfdl';

  // TODO
  const DESTINATION_ADDRESS = middleManContract.address;
  const DESTINATION_CHAIN = 'Ethereum';


  const callData = ethereumContract.interface.encodeFunctionData("app", [
    "fr",
    "baba"
  ]);

  
  const targets = [ethereumContract.address];
  const callDatas = [callData];
  
  const payload = encode(
    ["address[]", "bytes[]"],
    [targets, callDatas]
  );

  // const payload = encode(['string', 'string'], ['agoric1estsewt6jqsx77pwcxkn5ah0jqgu8rhgflwfdl', 'Hello, world!']);

  const memo = {
    destination_chain: DESTINATION_CHAIN,
    destination_address: DESTINATION_ADDRESS,
    payload: Array.from(payload),
    fee: null,
    type: 1,
  };

  const message = [
    {
      typeUrl: '/ibc.applications.transfer.v1.MsgTransfer',
      value: {
        sender: senderAddress,
        receiver: AXELAR_GMP_ADDRESS,
        token: {
          denom: IBC_DENOM_AXL_USDC,
          amount: AMOUNT_IN_ATOMIC_UNITS,
        },
        timeoutTimestamp: (Math.floor(Date.now() / 1000) + 600) * 1e9,
        sourceChannel: CHANNEL_ID,
        sourcePort: 'transfer',
        memo: JSON.stringify(memo),
      },
    },
  ];


  const fee = {
    gas: '250000',
    amount: [{ denom: DENOM, amount: '30000' }],
  };

  console.log('Preparing to send tokens...');
  const signingClient = await SigningStargateClient.connectWithSigner(
    'http://localhost/agoric-rpc',
    signer.owner
  );
  // Set up the Relayer for Wasm Chain
  evmRelayer.setRelayer(RelayerType.Agoric, axelarRelayer);

  console.log('Sending transaction...', message);
  const response = await signingClient.signAndBroadcast(
    senderAddress,
    message,
    fee
  );
  console.log('transaction response', response);

  // await ethereumContract.app('fraz', '123');
  // Relay messages between Ethereum and Agoric chains



  await relay({
    agoric: axelarRelayer,
    evm: evmRelayer,
  });


  // // Verify the message on the Ethereum contract
  const ethereumMessage1 = await middleManContract.storedMessage();
  console.log('Message on Ethereum Contract:', ethereumMessage1);
  const ethereumMessage = await ethereumContract.storedMessage();
  console.log('Message on Ethereum Contract:', ethereumMessage);

};
