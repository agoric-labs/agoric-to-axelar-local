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
        LCA1[LCA account 1]
        LCA2[LCA account 2]
        LCAn[LCA account n]
    end
    
    subgraph "Remote Account Router System"
        PR[RemoteAccountAxelarRouter]
        RAF[RemoteAccountFactory<br/>CREATE2 Factory]
        RA1[RemoteAccount 1]
        RA2[RemoteAccount 2]
        RAn[RemoteAccount N]
    end
    
    subgraph "External Contracts"
        AXL[Axelar Gateway]
        P2[Permit2]
        PROTO[DeFi Protocols]
    end
    
    LCA1 --> PR
    LCA2 --> PR
    LCAn --> PR
    PR --> |validateContractCall| AXL
    PR -->|provide| RAF
    RAF ==>|creates| RA1
    RAF ==>|creates| RA2
    RAF ==>|creates| RAn
    PR -->|executeCalls| RA1
    PR -->|executeCalls| RA2
    PR -->|executeCalls| RAn
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
    subgraph "Inherited Behaviors"
        AXLEXEC[AxelarExecutable]
        ROUTER[IRemoteAccountRouter]
    end
    
    subgraph "RemoteAccountAxelarRouter Components"
        direction TB
        EXE[_execute<br/>Message Handler]
        VALIDATE[Axelar inbound validation]
        PROC[processInstruction]
        DEP[Permit2 Integration]
        PROV[account creation/<br>verification]
        MULTI[account use]
        REP[replaceOwner<br/>migration support]
    end
    
    subgraph "State"
        SRCCHAIN[axelarSourceChainHash]
        PER[permit2: IPermit2]
        FAC[factory: IRemoteAccountFactory]
        AUTH[ownerAuthority: address]
        REPL[replacementOwner_: IReplaceableOwner]
    end
    
    RAn[RemoteAccount N]

    %% inheritance
    AXLEXEC --> EXE
    ROUTER --> EXE
    
    %% operation
    EXE --> VALIDATE
    EXE -->|decode| PROC
    PROC -.->|effect deposit| DEP
    PROC -->|provide account| PROV
    PROC --> MULTI
    
    %% state access
    VALIDATE -->|checks| SRCCHAIN
    DEP -->|uses| PER
    PROV -->|calls provide| FAC
    MULTI --> |calls executeCalls| RAn
    REP -->|updates| REPL
    REP -->|checks| AUTH
    
    style EXE fill:#ffe6e6
    style PROC fill:#fff0e6
    style DEP fill:#e6f7ff
    style PROV fill:#f0ffe6
    style MULTI fill:#ffe6f7
    style RAn fill:#ccccff
```

**Key Components**:
- **_execute**: Validates source chain, decodes RouterInstruction
- **processInstruction**: Atomically handles (depositPermit?, multiCalls) input, automatically performing account provisioning/verification
- **Permit2 Integration**: Transfers tokens to RemoteAccount via Permit2 signature-based transfers
- **account creation/verification**: Creates or verifies RemoteAccount via factory
- **account use**: Instructs RemoteAccount to execute arbitrary multicalls
- **replaceOwner**: Enables ownership transfer to new router versions

----
## C4 Level 3: Component Diagram - RemoteAccount

```mermaid
graph TB
    subgraph "Inherited Behaviors"
        Ownable
        OwnableByReplaceableOwner
        IRemoteAccount
    end
    
    subgraph "RemoteAccount Components"
        executeCalls
        replaceOwner
        _replaceOwner
        onlyOwner
        transferOwnership
    end
    
    subgraph "State & Validation"
        owner[owner: address]
    end
    
    EXTERNAL[target contracts]
    
    %% inheritance
    IRemoteAccount -.->|override| executeCalls
    Ownable --> OwnableByReplaceableOwner
    OwnableByReplaceableOwner -->|provides| _replaceOwner
    Ownable -->|provides| onlyOwner
    Ownable -->|provides| transferOwnership
    Ownable -->|provides| owner
    
    %% operation
    executeCalls -->|modifier| onlyOwner
    executeCalls -.->|loops & calls| EXTERNAL
    executeCalls -.->|calls| replaceOwner
    replaceOwner -->|calls| _replaceOwner
    _replaceOwner -->|calls| transferOwnership
    
    %% state access
    onlyOwner -->|checks| owner
    transferOwnership -->|updates| owner
    
    style executeCalls fill:#e6f3ff
    style replaceOwner fill:#ffe6f0
```

**Key Components**:
- **executeCalls**: Validates owner, then atomically executes array of contract calls
- **replaceOwner**: Enables migration by transferring to designated replacement owner

## C4 Level 3: Component Diagram - RemoteAccountFactory

```mermaid
graph TB
    subgraph "Inherited Behaviors"
        Ownable
        OwnableByReplaceableOwner
        IRemoteAccount
        IRemoteAccountFactory
    end

    subgraph "RemoteAccountFactory Components"
        getRemoteAccountAddress
        _getRemoteAccountAddress

        verifyRemoteAccount
        _verifyRemoteAccountOwner

        provide
        SAME_OWNER{owner matches?}
        _provideForRouter
        ACCOUNT_EXISTS{account exists?}
        provideForRouter[provideForRouter<br>Privileged create with specific owner]

        _getSalt[_getSalt<br>deterministic by CAIP-10 principal acount]

        executeCalls
        replaceOwner
        _replaceOwner
        onlyOwner
        transferOwnership
    end
    
    subgraph "State & Validation"
        _principalSalt[bytes32: _principalSalt]
        _remoteAccountBytecodeHash[bytes32: _remoteAccountBytecodeHash]
        owner[owner: address]
    end
    
    RAn[RemoteAccount N]
    
    %% inheritance
    IRemoteAccount -.->|override| executeCalls
    IRemoteAccountFactory -.->|override| getRemoteAccountAddress
    IRemoteAccountFactory -.->|override| verifyRemoteAccount
    IRemoteAccountFactory -.->|override| provide
    Ownable --> OwnableByReplaceableOwner
    OwnableByReplaceableOwner -->|provides| _replaceOwner
    Ownable -->|provides| onlyOwner
    Ownable -->|provides| transferOwnership
    Ownable -->|provides| owner
    
    %% operation
    getRemoteAccountAddress -->|calls| _getSalt
    getRemoteAccountAddress -->|calls| _getRemoteAccountAddress
    verifyRemoteAccount -->|calls| _getSalt
    verifyRemoteAccount -->|calls| _getRemoteAccountAddress
    verifyRemoteAccount -->|calls| _verifyRemoteAccountOwner
    _verifyRemoteAccountOwner -.->|"calls owner()"| RAn
    provide --> SAME_OWNER
    SAME_OWNER -.->|no: calls| verifyRemoteAccount
    SAME_OWNER -.->|yes: calls| _provideForRouter
    _provideForRouter -->|calls| _getSalt
    _provideForRouter -->|calls| _getRemoteAccountAddress
    _provideForRouter --> ACCOUNT_EXISTS
    ACCOUNT_EXISTS -.->|yes: calls| _verifyRemoteAccountOwner
    ACCOUNT_EXISTS -.->|no: deterministically creates| RAn
    provideForRouter -->|calls| _provideForRouter
    executeCalls -->|modifier| onlyOwner
    executeCalls -.->|calls| replaceOwner
    executeCalls -.->|calls| provideForRouter
    replaceOwner -->|calls| _replaceOwner
    _replaceOwner -->|calls| transferOwnership
    
    %% state access
    _getRemoteAccountAddress -.->|reads| _principalSalt
    _getRemoteAccountAddress -.->|reads| _remoteAccountBytecodeHash
    _verifyRemoteAccountOwner -.->|checks| owner
    provide -->|checks| owner
    onlyOwner -->|checks| owner
    transferOwnership -->|updates| owner
    
    style provide fill:#e6ffe6
    style _provideForRouter fill:#ffe6e6
```

**Key Components**:
- **provide**: Public method requiring caller is current factory owner
- **provideForRouter**: Self-call method allowing arbitrary router specification
- **_provideForRouter**: Core CREATE2 logic with deterministic address generation
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
    
    PM->>AXL: send RouterInstruction
    AXL->>PR: _execute(sourceChain, sourceAddress, payload)
    
    PR->>PR: validate source chain
    PR->>PR: decode RouterInstruction
    
    critical [processInstruction(instruction)]
        opt if depositPermit exists
            PR->>P2: permitWitnessTransferFrom(...)
            P2->>RA: transfer tokens
            RA->>RA: emit Received(msg.sender, msg.value)
        end

        PR->>RAF: provide(sourceAddress, self, expectedAddress)
        opt if does not exist
            RAF->>RA: CREATE2
            RAF->>RA: transferOwnership(self)
        end

        opt if multiCalls exist
            PR->>RA: executeCalls(multiCalls)
            RA->>RA: Validate owner
            loop for each call{target, data}
                RA->>DEFI: call(target, data)
                DEFI-->>RA: result
            end
        end
    option [success]
        PR->>PR: emit OperationResult(id, true, '')
    option [failure]
        PR->>PR: emit OperationResult(id, false, reason)
    end
```

**Flow Description**:
1. Portfolio Manager sends instructions via Axelar GMP
2. RemoteAccountAxelarRouter validates message source
3. If requested, RemoteAccountAxelarRouter transfers tokens via Permit2
4. RemoteAccountAxelarRouter provides account (creating if necessary)
5. If calls for RemoteAccount exist, RemoteAccountAxelarRouter sends them and RemoteAccount executes them
6. RemoteAccountAxelarRouter emits an event describing success or failure

# FIXME: The remainder has not yet been edited

## Ownership and Security Model

```mermaid
graph TB
    Axelar["Axelar<br>(including inherited contract code)"]
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
    
    EVM_OPERATOR -.->|replaceOwner| ROUTER1
    EVM_OPERATOR -.->|replaceOwner| ROUTER2
    EVM_OPERATOR -.->|replaceOwner| ROUTERn
    
    ROUTER1 ==>|owns| RA1
    ROUTER1 -->|"executeCalls&lt;replaceOwner&gt;"| RA1
    ROUTER1 -.->|transferred| RA2
    ROUTER1 -.->|transferred| RAF
    ROUTER1 -.->|old replacementOwner_| ROUTER2
    ROUTER1 -->|replacementOwner_| ROUTERn
    ROUTER2 -.->|transferred| RAF
    ROUTER2 -->|replacementOwner_| ROUTERn
    ROUTERn ==>|owns| RA2
    ROUTERn ==>|owns| RAn
    ROUTERn -->|executeCalls| RAn
    ROUTERn ==>|owns| RAF
    ROUTERn -->|"executeCalls&lt;provide|provideForRouter&gt;"| RAF
    
    style Axelar fill:#ffe6e6
    style EVM_OPERATOR fill:#ffe6e6
    style ROUTER1 fill:#e8e8e8
    style ROUTER2 fill:#e8e8e8
    style ROUTERn fill:#e6ffe6
```

**Ownership**:
- Current RemoteAccountAxelarRouter owns RemoteAccountFactory and all new accounts
- Ownership of old accounts is transferred upon activity (old router calls `replaceOwner`)

**Security Checks**:
- **RemoteAccountAxelarRouter `replaceOwner`**: Validate `msg.sender` against immutable `ownerAuthority`
- **RemoteAccountAxelarRouter `_execute`**: Validate sourceChain against immutable hash
- **RemoteAccountFactory `provide`**: For account creation, validate requested owner against its own owner
- **RemoteAccountFactory `provideForRouter`**: Validate self-call (from `executeCalls`)
- **RemoteAccountFactory/RemoteAccount `executeCalls`**: Validate that sender is current owner
- **RemoteAccountFactory/RemoteAccount `replaceOwner`**: Validate self-call (from `executeCalls`) and (via OwnableByReplaceableOwner inheritance) that the old owner confirms the requested new owner

**Security Layers**:
1. **Axelar Validation**: Only messages from specific chain and address accepted
2. **Principal Validation**: RemoteAccount verifies CAIP-10 identity of controller
3. **Ownership**: Router owns all RemoteAccounts and Factory
4. **Replaceability**: Migration path via designated replacement owner

## Deployment

```mermaid
sequenceDiagram
    participant PM as Portfolio Manager<br>(Agoric)
    participant EVM_OPERATOR as EVM operator<br>multisig
    participant ROUTER1 as RemoteAccountAxelarRouter<br>v1
    participant ROUTER2 as RemoteAccountAxelarRouter<br>v2
    participant ROUTERn as RemoteAccountAxelarRouter<br>v3
    participant RAF as RemoteAccountFactory
    participant RA1 as RemoteAccount<br>(old)
    participant RAn as RemoteAccount<br>(new)

    Note over PM,RAn: Deploy new router
    EVM_OPERATOR->>ROUTERn: deploy

    Note over PM,RAn: Update old routers
    par
        EVM_OPERATOR->>ROUTER1: replaceOwner(new router)
        EVM_OPERATOR->>ROUTER2: replaceOwner(new router)
    end

    Note over PM,RAn: Upgrade contract for new router
    PM->>PM: upgrade
    PM->>ROUTER2: [via Axelar] send RouterInstruction{factoryAddr, [ContractCall{factoryAddr, encodeCall(replaceOwner)}]}
    ROUTER2->>RAF: executeCalls([ContractCall{factoryAddr, encodeCall(replaceOwner)}])
    critical replaceOwner
        RAF->>ROUTER2: replacementOwner()
        RAF->>RAF: confirm match
        RAF->>RAF: replace owner
    end
    ROUTER2->>PM: [via Resolver] ready
    PM->>PM: Switch to new router

    Note over PM,RAn: Account interactions
    opt Transfer old account
        PM->>ROUTER1: [via Axelar] send RouterInstruction{addr, [ContractCall{addr, encodeCall(replaceOwner)}]}
        ROUTER1->>RA1: executeCalls([ContractCall{addr, encodeCall(replaceOwner)}])
        RA1->>RA1: replaceOwner
        critical replaceOwner
            RA1->>ROUTER1: replacementOwner()
            RA1->>RA1: confirm match
            RA1->>RA1: replace owner
        end
    end
    opt Create new account
        PM->>ROUTERn: [via Axelar] send RouterInstruction{factoryAddr, [ContractCall{factoryAddr, encodeCall(provide)}]}
        ROUTERn->>RAF: executeCalls([ContractCall{factoryAddr, encodeCall(provide)}])
        RAF->>RAF: provide
        RAF->>RAn: CREATE2
    end
```

**Migration Features**:
- Non-disruptive: Can migrate one account at a time
- Safe: Requires both old and new router agreement
- Flexible: RemoteAccount addresses remain constant
- Auditable: All transfers via on-chain multicalls
