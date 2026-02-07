# Remote Account Router System - Design Documentation

This document provides C4-style architectural diagrams documenting the Solidity smart contracts that enable cross-chain portfolio management through [Axelar General Message Passing (GMP)](https://docs.axelar.dev/dev/general-message-passing/overview/).

## System Overview

The system enables remote account management where a portfolio manager on an Agoric chain can control accounts and executes operations on EVM chains through GMP.

## C4 Level 1: System Context Diagram

```mermaid
graph TB
    subgraph "Agoric Chain"
        PM[Portfolio Manager]
    end
    
    subgraph "Axelar Network"
        EX[Axelar Relayer]
    end
    
    subgraph "EVM Chain"
        PRS[Remote Account Router<br>System]
  
        subgraph "External Systems"
            P2[Permit2 Contract]
            DEFI[DeFi Protocols]
        end
    end

    PM -->|Send Instructions| EX
    EX -->|Execute Message| PRS
    PRS -->|Transfer Tokens| P2
    PRS -->|Interact| DEFI
    
    style PM fill:#e1f5ff
    style PRS fill:#ffe1e1
```

**Context**: The Remote Account Router System acts as a trusted intermediary that receives cross-chain messages from a portfolio manager on Agoric and directs operation of accounts on the EVM chain.

## C4 Level 2: Container Diagram - Data Plane Operations

```mermaid
graph TB
    subgraph "Agoric Chain"
        YMAX[Portfolio Manager<br>contract]
        LCA1[LCA account 1]
        LCA2[LCA account 2]
        LCAn[LCA account n]
    end
    
    AXL[Axelar]
    
    subgraph "Remote Account Router System"
        PR[RemoteAccountAxelarRouter]
        RAF[RemoteAccountFactory<br/>CREATE2 Factory]
        RA1[RemoteAccount 1]
        RA2[RemoteAccount 2]
        RAn[RemoteAccount N]
    end
    
    subgraph "External Contracts"
        P2[Permit2]
        PROTO[DeFi Protocols]
    end
    
    YMAX --> AXL
    LCA1 --> AXL
    LCA2 --> AXL
    LCAn --> AXL
    AXL -->|_execute| PR
    PR -->|provide| RAF
    RAF ==>|creates| RA1
    RAF ==>|creates| RA2
    RAF ==>|creates| RAn
    PR -->|"executeCalls |<br>transferOwnership"| RA1
    PR -->|"executeCalls |<br>transferOwnership"| RA2
    PR -->|"executeCalls |<br>transferOwnership"| RAn
    PR -.->|permitWitnessTransferFrom| P2
    RA1 -->|call| PROTO
    RA2 -->|call| PROTO
    RAn -->|call| PROTO
    
    style PR fill:#ffcccc
    style RAF fill:#ccffcc
    style RA1 fill:#ccccff
    style RA2 fill:#ccccff
    style RAn fill:#ccccff
```

**Containers**:
- **RemoteAccountAxelarRouter**: Entry point receiving messages from Axelar
- **RemoteAccountFactory**: CREATE2 factory deploying RemoteAccount contracts at deterministic addresses
- **RemoteAccount**: Individual wallet contracts acting on behalf of external principals (each one an Agoric local chain account [LCA]), executing DeFi operations

## C4 Level 3: Component Diagram - RemoteAccountAxelarRouter

```mermaid
graph TB
    subgraph AxelarExecutable
        AxelarExecutable__execute["_execute<br>(message handler)"]
    end
    subgraph ImmutableOwnable
        %% modifiers
        onlyOwner@{shape: odd}
        %% state
        owner@{shape: stored-data, label: "owner: address"}
    end
    subgraph IRemoteAccountRouter
        IRemoteAccountRouter_factory["factory(): IRemoteAccountFactory"]
        IRemoteAccountRouter_permit2["permit2(): IPermit2"]
        IRemoteAccountRouter_processProvideRemoteAccountInstruction[processProvideRemoteAccountInstruction]
        IRemoteAccountRouter_processRemoteAccountExecuteInstruction[processRemoteAccountExecuteInstruction]
        IRemoteAccountRouter_processUpdateOwnerInstruction[processUpdateOwnerInstruction]
        subgraph IRemoteAccountRouter_state[state]
            successor["successor(): address"]
        end
        %% events
        OperationResult@{shape: flag}
    end
    
    subgraph RemoteAccountAxelarRouter
        START@{shape: start}
        _execute["_execute<br/>override AxelarExecutable"]
        VALIDATE@{shape: text, label: "Axelar inbound validation"}
        DECODE{decode and select}
        processProvideRemoteAccountInstruction["processProvideRemoteAccountInstruction<br>override IRemoteAccountRouter"]
        processProvideRemoteAccountInstruction_self@{shape: comment, label: "require self-call"}
        processRemoteAccountExecuteInstruction["processRemoteAccountExecuteInstruction<br>override IRemoteAccountRouter"]
        processRemoteAccountExecuteInstruction_self@{shape: comment, label: "require self-call"}
        processUpdateOwnerInstruction["processUpdateOwnerInstruction<br>override IRemoteAccountRouter"]
        processUpdateOwnerInstruction_self@{shape: comment, label: "require self-call"}
        DEP@{shape: text, label: "Permit2 Integration"}
        PROV@{shape: text, label: "account creation/<br>verification"}
        MULTI@{shape: text, label: "account use"}
        setSuccessor
        subgraph state
            factory@{shape: stored-data, label: "factory: IRemoteAccountFactory<br>override IRemoteAccountRouter"}
            permit2@{shape: stored-data, label: "permit2: IPermit2<br>override IRemoteAccountRouter"}
            axelarSourceChainHash@{shape: stored-data, label: "axelarSourceChainHash: bytes32"}
            successor@{shape: stored-data, label: "successor: address"}
        end
    end
    
    RAn[RemoteAccount N]

    %% inheritance
    RemoteAccountAxelarRouter -.->|is| AxelarExecutable
    RemoteAccountAxelarRouter -.->|is| IRemoteAccountRouter
    RemoteAccountAxelarRouter -.->|is| ImmutableOwnable
    
    %% operation
    START --> _execute
    START --> setSuccessor
    _execute -->|"[1]"| VALIDATE
    _execute -->|"[2]"| DECODE
    DECODE -.-> processProvideRemoteAccountInstruction
    DECODE -.-> processRemoteAccountExecuteInstruction
    DECODE -.-> processUpdateOwnerInstruction
    processProvideRemoteAccountInstruction --> processProvideRemoteAccountInstruction_self
    processProvideRemoteAccountInstruction -.->|"[1] effect deposit"| DEP
    processProvideRemoteAccountInstruction -->|"[2] provide account"| PROV
    processRemoteAccountExecuteInstruction -->|"[1] provide account"| PROV
    processRemoteAccountExecuteInstruction --> processRemoteAccountExecuteInstruction_self
    processRemoteAccountExecuteInstruction -->|"[2] send calls"| MULTI
    _execute -->|"[3] emit"| OperationResult
    
    %% state/dependency access
    VALIDATE -->|checks| axelarSourceChainHash
    DEP -->|call<br>permitWitnessTransferFrom| permit2
    PROV -->|call provide| factory
    MULTI --> |call executeCalls| RAn
    processUpdateOwnerInstruction --> processUpdateOwnerInstruction_self
    processUpdateOwnerInstruction -->|"[1] checks"| successor
    processUpdateOwnerInstruction -->|"[2] call provide"| factory
    processUpdateOwnerInstruction -->|"[3] call transferOwnership"| RAn
    setSuccessor -->|updates| successor
    setSuccessor -->|modifier| onlyOwner
    onlyOwner -->|checks| owner
    
    style _execute fill:#ffe6e6
    style setSuccessor fill:#ffe6e6
    style processProvideRemoteAccountInstruction fill:#fff0e6
    style processRemoteAccountExecuteInstruction fill:#fff0e6
    style processUpdateOwnerInstruction fill:#fff0e6
    style RAn fill:#ccccff
```

**Key Components**:
- **_execute**: Validates source chain, decodes the RouterInstruction selector + payload
- **processProvideRemoteAccountInstruction**: Atomically redeems an optional deposit permit and provisions/verifies a RemoteAccount via the factory
- **processRemoteAccountExecuteInstruction**: Atomically provisions/verifies a RemoteAccount and executes its multicall batch
- **processUpdateOwnerInstruction**: Transfers factory or remote account ownership to a new router
- **Permit2 Integration**: Transfers tokens to RemoteAccount via Permit2 signature-based transfers
- **account creation/verification**: Creates or verifies RemoteAccount via factory
- **account use**: Instructs RemoteAccount to execute arbitrary multicalls
- **setSuccessor**: Enables ownership transfer to new router versions

----
## C4 Level 3: Component Diagram - RemoteAccount

```mermaid
graph TB
    subgraph Ownable
        owner
        transferOwnership
        renounceOwnership
        %% modifiers
        onlyOwner@{shape: odd}
    end
    subgraph IRemoteAccount
        IRemoteAccount_executeCalls[executeCalls]
    end
    
    subgraph RemoteAccount
        START@{shape: start}
        executeCalls
    end
    
    EXTERNAL[target contracts]
    
    %% inheritance
    RemoteAccount -.->|is| Ownable
    RemoteAccount -.->|is| IRemoteAccount
    executeCalls -.->|override| IRemoteAccount_executeCalls
    
    %% operation
    START --> executeCalls
    START --> transferOwnership
    START --> renounceOwnership
    executeCalls -->|modifier| onlyOwner
    executeCalls -.->|loops & calls| EXTERNAL
    transferOwnership -->|modifier| onlyOwner
    renounceOwnership -->|modifier| onlyOwner
    
    %% state access
    onlyOwner -->|checks| owner
    transferOwnership -->|updates| owner
    renounceOwnership -->|updates| owner
    
    style executeCalls fill:#ffe6e6
    style transferOwnership fill:#ffe6e6
    style renounceOwnership fill:#ffe6e6
```

**Key Components**:
- **executeCalls**: Validates owner, then atomically executes array of contract calls

## C4 Level 3: Component Diagram - RemoteAccountFactory

```mermaid
graph TB
    subgraph Ownable
        owner
        transferOwnership
        renounceOwnership
        %% modifiers
        onlyOwner@{shape: odd}
    end
    subgraph IRemoteAccountFactory
        IRemoteAccountFactory_verifyFactoryPrincipalAccount[verifyFactoryPrincipalAccount]
        IRemoteAccountFactory_getRemoteAccountAddress[getRemoteAccountAddress]
        IRemoteAccountFactory_verifyRemoteAccount[verifyRemoteAccount]
        IRemoteAccountFactory_provide[provide]
        IRemoteAccountFactory_provideForOwner[provideForOwner]
        %% events
        RemoteAccountCreated@{shape: flag}
    end

    subgraph RemoteAccountFactory
        START@{shape: start}
        getRemoteAccountAddress["getRemoteAccountAddress<br>override IRemoteAccountFactory"]
        _getRemoteAccountAddress

        verifyRemoteAccount["verifyRemoteAccount<br>override IRemoteAccountFactory"]
        _verifyRemoteAccountOwner

        provide["provide<br>override IRemoteAccountFactory"]
        provideForOwner["provideForOwner<br>override IRemoteAccountFactory"]
        SAME_OWNER{owner matches<br>expected owner?}
        _provideForOwner
        ACCOUNT_EXISTS{account exists?}
        MAKE_ACCOUNT@{shape: text, label: "create account"}

        _getSalt[_getSalt<br>deterministic by CAIP-10 principal acount]
        subgraph state
            factoryPrincipalCaip2@{shape: stored-data}
            factoryPrincipalAccount@{shape: stored-data}
            _principalSalt@{shape: stored-data}
            _remoteAccountBytecodeHash@{shape: stored-data}
        end
    end
    
    RAn[RemoteAccount N]
    
    %% inheritance
    RemoteAccountFactory -.->|is| Ownable
    RemoteAccountFactory -.->|is| IRemoteAccountFactory
    
    %% operation
    START --> provide
    START --> provideForOwner
    START --> verifyRemoteAccount
    START --> getRemoteAccountAddress
    START --> transferOwnership
    START --> renounceOwnership
    provide --> SAME_OWNER
    SAME_OWNER -.->|no: calls| verifyRemoteAccount
    SAME_OWNER -.->|yes: calls| _provideForOwner
    provideForOwner --> _provideForOwner
    verifyRemoteAccount -->|calls| _getSalt
    verifyRemoteAccount -->|calls| _getRemoteAccountAddress
    verifyRemoteAccount -->|calls| _verifyRemoteAccountOwner
    _verifyRemoteAccountOwner -.->|"call owner()"| RAn
    _provideForOwner -->|calls| _getSalt
    _provideForOwner -->|calls| _getRemoteAccountAddress
    _provideForOwner --> ACCOUNT_EXISTS
    ACCOUNT_EXISTS -.->|yes: calls| _verifyRemoteAccountOwner
    ACCOUNT_EXISTS -.->|no| MAKE_ACCOUNT
    MAKE_ACCOUNT -->|"[1] deterministically creates"| RAn
    MAKE_ACCOUNT -->|"[2] emit"| RemoteAccountCreated
    getRemoteAccountAddress -->|calls| _getSalt
    getRemoteAccountAddress -->|calls| _getRemoteAccountAddress
    
    %% state access
    _getRemoteAccountAddress -.->|reads| _principalSalt
    _getRemoteAccountAddress -.->|reads| _remoteAccountBytecodeHash
    _verifyRemoteAccountOwner -.->|checks| owner
    SAME_OWNER -->|checks| owner
    onlyOwner -->|checks| owner
    transferOwnership -->|updates| owner
    renounceOwnership -->|updates| owner
    
    style provide fill:#ffe6e6
    style verifyRemoteAccount fill:#ffe6e6
    style getRemoteAccountAddress fill:#ffe6e6
    style transferOwnership fill:#ffe6e6
    style renounceOwnership fill:#ffe6e6
```

**Key Components**:
- **provide**: Public method requiring caller is current factory owner
- **provideForOwner**: Owner-only method to create or verify accounts for an arbitrary owner
- **_provideForOwner**: Core CREATE2 logic with deterministic address generation
- **verifyFactoryPrincipalAccount**: Validates the factory principal account string
- **Validation**: Multi-layer verification of existing accounts (code, principal, owner)

## Data Flow: Account creation and use

```mermaid
sequenceDiagram
    participant PM as Portfolio Manager<br/>(Agoric)
    participant AXL as Axelar Gateway
    participant PR as RemoteAccountAxelarRouter
    participant P2 as Permit2
    participant RAF as RemoteAccountFactory
    participant RA as RemoteAccount
    participant DEFI as DeFi Protocol

    Note right of PM: using portfolio LCA
    PM->>AXL: send ProvideRemoteAccountInstruction |<br>RemoteAccountExecuteInstruction |<br>UpdateOwnerInstruction
    AXL->>PR: _execute(sourceChain,<br>sourceAddress, payload)

    PR->>PR: validate source chain

    critical
        alt processProvideRemoteAccountInstruction
            Note over PR,RA: pull deposit
            opt if depositPermit exists
                PR->>P2: permitWitnessTransferFrom(...)
                P2->>RA: transfer tokens
            end

            Note over PR,RA: provide account
            PR->>RAF: provide(instruction.principalAccount,<br> address(this), expectedAddress)
            alt if exists
                RAF->>RA: owner()
                RAF->>RAF: verify match
            else
                RAF->>RA: CREATE2
                RAF->>RA: transferOwnership(router)
            end
        else processRemoteAccountExecuteInstruction
            Note over PR,RA: provide account
            PR->>RAF: provide(sourceAddress, address(this), expectedAddress)
            alt if exists
                RAF->>RA: owner()
                RAF->>RAF: verify match
            else
                RAF->>RA: CREATE2
                RAF->>RA: transferOwnership(router)
            end

            Note over PR,RA: make calls
            opt if multiCalls exist
                PR->>RA: executeCalls(multiCalls)
                RA->>RA: Validate owner
                loop for each {target, data}
                    RA->>DEFI: target.call(data)
                    DEFI-->>RA: result
                end
            end
        else processUpdateOwnerInstruction
            PR->>PR: verify newOwner is successor

            Note over PR,RA: provide account
            PR->>RAF: provide(sourceAddress, address(this), expectedAddress)
            alt if exists
                RAF->>RA: owner()
                RAF->>RAF: verify match
            else
                RAF->>RA: CREATE2
                RAF->>RA: transferOwnership(router)
            end

            Note over PR,RA: transfer to new router
            PR->>RA: transferOwnership(newOwner)
        end
    option [success]
        PR->>PR: emit OperationResult(id, true, '')
    option [failure]
        PR->>PR: emit OperationResult(id, false, reason)
    end
```

**Flow Description**:
1. Portfolio Manager sends instructions from portfolio LCA via Axelar GMP
2. RemoteAccountAxelarRouter validates message source
3. RemoteAccountAxelarRouter parses and processes input
     * For `processProvideRemoteAccountInstruction`:
         1. If requested, RemoteAccountAxelarRouter transfers tokens via Permit2
         2. RemoteAccountAxelarRouter provides account (creating if necessary)
     * For `processRemoteAccountExecuteInstruction`:
         1. RemoteAccountAxelarRouter provides account (creating if necessary)
         2. If calls for RemoteAccount exist, RemoteAccountAxelarRouter forwards them and RemoteAccount executes them
     * For `processUpdateOwnerInstruction`:
         1. RemoteAccountAxelarRouter verifies that the new owner identifies its successor
         2. RemoteAccountAxelarRouter provides account (creating if necessary)
         3. RemoteAccountAxelarRouter transfers account ownership
4. RemoteAccountAxelarRouter emits an event describing success or failure

## Ownership and Security Model

```mermaid
graph TB
    Axelar
    EVM_OPERATOR["EVM operator multisig"]
    ROUTER1[old RemoteAccountAxelarRouter v1]
    ROUTER2[old RemoteAccountAxelarRouter v2]
    ROUTERn[RemoteAccountAxelarRouter v3]
    RAF[RemoteAccountFactory]
    RA1["old RemoteAccount<br>(untouched by v2+)"]
    RA2["old RemoteAccount<br>(touched by v3)"]
    RAn[new RemoteAccount]

    Axelar -->|_execute| ROUTER1
    Axelar -->|_execute| ROUTER2
    Axelar -->|_execute| ROUTERn
    
    EVM_OPERATOR -.->|setSuccessor| ROUTER1
    EVM_OPERATOR -.->|setSuccessor| ROUTER2
    EVM_OPERATOR -.->|setSuccessor| ROUTERn
    
    ROUTER1 ==>|owns| RA1
    ROUTER1 -.->|transferred| RA2
    ROUTER1 -.->|transferred| RAF
    ROUTER1 -.->|old successor| ROUTER2
    ROUTER1 -->|successor| ROUTERn
    ROUTER2 -.->|transferred| RAF
    ROUTER2 -->|successor| ROUTERn
    ROUTERn ==>|owns| RA2
    ROUTERn ==>|owns| RAn
    ROUTERn ==>|owns| RAF
    
    style Axelar fill:#ffe6e6
    style EVM_OPERATOR fill:#ffe6e6
    style ROUTER1 fill:#e8e8e8
    style ROUTER2 fill:#e8e8e8
    style ROUTERn fill:#e6ffe6
```

**Ownership**:
- Current RemoteAccountAxelarRouter owns RemoteAccountFactory and all new accounts
- Ownership of old accounts is transferred upon activity (`transferOwnership` call through old router)

**Security Checks**:
- **RemoteAccountAxelarRouter `setSuccessor`**: Validate `msg.sender` against immutable `owner`
- **RemoteAccountAxelarRouter `_execute`**: Validate `sourceChain` against immutable hash
- **RemoteAccountAxelarRouter `processProvideRemoteAccountInstruction`**: Validate the source address as the factory principal. This ensures only the portfolio manager can redeem signed permit2 intents.
- **RemoteAccountFactory `provide`**: For account creation, validate requested owner against its own owner. Validates remote account address derives from sourceAddress.
- **RemoteAccountFactory/RemoteAccount `executeCalls` and `transferOwnership`**: Validate that sender is current owner

## Deployment

```mermaid
sequenceDiagram
    participant PM as Portfolio Manager<br>(Agoric)
    participant EVM_DEPLOYER as EVM deployer
    participant EVM_OPERATOR as EVM operator<br>multisig
    participant ROUTER1 as RemoteAccountAxelarRouter<br>v1
    participant ROUTER2 as RemoteAccountAxelarRouter<br>v2
    participant ROUTERn as RemoteAccountAxelarRouter<br>v3
    participant RAF as RemoteAccountFactory
    participant RA as RemoteAccount

    Note over PM,RA: Initial deployment
    EVM_DEPLOYER->>RAF: deploy
    EVM_DEPLOYER->>ROUTER1: deploy
    EVM_DEPLOYER->>RAF: transferOwnership to router

    Note over PM,RA: Deploy new router
    EVM_DEPLOYER->>ROUTERn: deploy

    Note over PM,RA: Update old routers
    par
        EVM_OPERATOR->>ROUTER1: setSuccessor(new router)
        EVM_OPERATOR->>ROUTER2: setSuccessor(new router)
    end

    Note over PM,RA: Upgrade contract for new router
    PM->>PM: upgrade
    PM->>ROUTER2: [via Axelar] send (processUpdateOwnerInstruction, txId, factoryAddr, UpdateOwnerInstruction{newRouterAddr})
    ROUTER2->>RAF: transferOwnership(newRouterAddr)
    RAF->>RAF: confirm sender is current owner
    RAF->>RAF: replace owner
    ROUTER2->>PM: [via Resolver] ready
    PM->>PM: new router ready
    
    Note over PM,RA: Account interactions
    opt if account uses old router
        PM->>ROUTER1: [via Axelar] send (processUpdateOwnerInstruction, txId, addr, UpdateOwnerInstruction{newRouterAddr})
        ROUTER1->>RAF: provide
        RAF-->>RA: create/validate
        ROUTER1->>RA: transferOwnership(newRouterAddr)
        RA->>RA: confirm sender is current owner
        RA->>RA: replace owner
    end
    PM->>ROUTERn: [via Axelar] send (processRemoteAccountExecuteInstruction, txId, expectedAddr, RemoteAccountInstruction{...})
    ROUTERn->>RAF: provide
    RAF-->>RA: create/validate
    ROUTERn->>RA: executeCalls
```

**Migration Features**:
- Non-disruptive: Can migrate one account at a time
- Safe: Requires both owner of old router and portfolio manager agreement
- Flexible: RemoteAccount addresses remain constant
- Auditable: All account changes performed via cross-chain messages.
