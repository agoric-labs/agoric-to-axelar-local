import { CosmosClient, IBCRelayerClient, AxelarListener, retry } from ".."; // Replace with your actual import path

export class IBCRelayerService {
  wasmClient: CosmosClient;
  axelarClient: CosmosClient;
  relayerClient: IBCRelayerClient;
  srcChannelId?: string;
  destChannelId?: string;
  currentInterval?: NodeJS.Timeout;

  private constructor(
    wasmClient: CosmosClient,
    axelarClient: CosmosClient,
    relayerClient: IBCRelayerClient
  ) {
    this.wasmClient = wasmClient;
    this.axelarClient = axelarClient;
    this.relayerClient = relayerClient;
  }

  static async create(testMnemonic?: string) {
    const agoricClient = await CosmosClient.create("agoric");
    const axelarClient = await CosmosClient.create("axelar");
    const relayerClient = await IBCRelayerClient.create(testMnemonic);

    return new IBCRelayerService(agoricClient, axelarClient, relayerClient);
  }

  public async relay() {
    return retry(async () => {
      return this.relayerClient.relayPackets();
    });
  }

  public async createIBCChannelIfNeeded() {
    if (!this.relayerClient.link) {
      const relayerAccountManager =
        this.relayerClient.getRelayerAccountManager();
      await relayerAccountManager.fundRelayerAccountsIfNeeded();

      // Initialize the connection and channel
      await this.relayerClient.initConnection(true);
      const { dest, src } = await this.relayerClient.createChannel("B", true);
      this.srcChannelId = src.channelId;
      this.destChannelId = dest.channelId;
    }
  }

  public async runInterval(interval: number = 10000) {
    await this.createIBCChannelIfNeeded();

    // Use new account to relay packets
    this.currentInterval = setInterval(async () => {
      await this.relay();
    }, interval);
  }

  public async stopInterval() {
    clearInterval(this.currentInterval);
  }
}
