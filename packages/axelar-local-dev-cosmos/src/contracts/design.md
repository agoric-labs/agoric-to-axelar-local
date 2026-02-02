# Portfolio Router and Remote Account System - Design Documentation

This document provides C4-style architectural diagrams documenting the Solidity smart contracts that enable cross-chain portfolio management through Axelar GMP (General Message Passing).

## System Overview

The system enables remote portfolio management where a portfolio manager on Agoric chain can control accounts and execute operations on EVM chains through Axelar's cross-chain messaging protocol.

## C4 Level 1: System Context Diagram

```mermaid
graph TB
    subgraph "Agoric Chain"
        PM[Portfolio Manager]
    end
    
    subgraph "Axelar Network"
        AG[Axelar Gateway]
    end
    
    subgraph "EVM Chain"
        PRS[Portfolio Router System]
    end
    
    subgraph "External Systems"
        P2[Permit2 Contract]
        DEFI[DeFi Protocols]
    end
    
    PM -->|Send Instructions| AG
    AG -->|Execute Message| PRS
    PRS -->|Transfer Tokens| P2
    PRS -->|Interact| DEFI
    
    style PM fill:#e1f5ff
    style PRS fill:#ffe1e1
    style AG fill:#fff4e1
```

**Context**: The Portfolio Router System acts as a trusted intermediary that receives cross-chain messages from a portfolio manager on Agoric and executes operations on behalf of remote accounts on the EVM chain.

## C4 Level 2: Container Diagram

```mermaid
graph TB
    subgraph "Portfolio Router System"
        PR[PortfolioRouter<br/>AxelarExecutable]
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
    
    AXL -->|_execute| PR
    PR -->|provide| RAF
    RAF -.->|creates| RA1
    RAF -.->|creates| RA2
    RAF -.->|creates| RAn
    PR -->|executeCalls| RA1
    PR -->|executeCalls| RA2
    PR -->|executeCalls| RAn
    PR -->|permitWitnessTransferFrom| P2
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
- **PortfolioRouter**: Entry point receiving Axelar messages and orchestrating operations
- **RemoteAccountFactory**: CREATE2 factory deploying RemoteAccount contracts at deterministic addresses
- **RemoteAccount**: Individual wallet contracts representing remote principals, executing DeFi operations

## C4 Level 3: Component Diagram - PortfolioRouter

```mermaid
graph TB
    subgraph "PortfolioRouter Components"
        direction TB
        EXE[_execute<br/>Message Handler]
        PROC[processInstruction<br/>Instruction Processor]
        DEP[Deposit Handler<br/>Permit2 Integration]
        PROV[Provide Handler<br/>Account Creation]
        MULTI[Multicall Handler<br/>DeFi Operations]
        REP[replaceOwner<br/>Migration Support]
    end
    
    subgraph "Inherited Behaviors"
        AXLEXEC[AxelarExecutable]
        REMREP[RemoteRepresentative]
    end
    
    subgraph "State"
        FAC[factory: IRemoteAccountFactory]
        PER[permit2: IPermit2]
        AUTH[ownerAuthority: address]
        REPL[replacementOwner_: IReplaceableOwner]
    end
    
    AXLEXEC --> EXE
    REMREP --> EXE
    EXE -->|decode & iterate| PROC
    PROC --> DEP
    PROC --> PROV
    PROC --> MULTI
    DEP -->|uses| PER
    PROV -->|uses| FAC
    REP -->|updates| REPL
    REP -->|checks| AUTH
    
    style EXE fill:#ffe6e6
    style PROC fill:#fff0e6
    style DEP fill:#e6f7ff
    style PROV fill:#f0ffe6
    style MULTI fill:#ffe6f7
```

**Key Components**:
- **_execute**: Validates source chain/address, decodes RouterInstruction array
- **processInstruction**: Atomically processes deposit → provide → multicall sequence
- **Deposit Handler**: Transfers tokens via Permit2 signature-based transfers
- **Provide Handler**: Creates or verifies RemoteAccount via factory
- **Multicall Handler**: Executes arbitrary contract calls through RemoteAccount
- **Migration Support**: Enables ownership transfer to new router versions

## C4 Level 4: Component Diagram - RemoteAccount

```mermaid
graph TB
    subgraph "RemoteAccount Components"
        direction TB
        EXEC[executeCalls<br/>Call Executor]
        REPL[replaceOwner<br/>Owner Migration]
    end
    
    subgraph "Inherited Behaviors"
        OWN[OwnableByReplaceableOwner]
        REP[RemoteRepresentative]
    end
    
    subgraph "State & Validation"
        PRIN[Principal Identity<br/>CAIP-10]
        OWN_STATE[Owner Address]
        REPL_STATE[Replacement Owner]
    end
    
    REP -->|provides| PRIN
    OWN -->|provides| OWN_STATE
    OWN -->|provides| REPL_STATE
    
    EXEC -->|requires| OWN
    EXEC -->|validates| PRIN
    EXEC -->|loops & calls| CALLS[Target Contracts]
    
    REPL -->|validates sender| SELF[Self-call Check]
    REPL -->|validates replacement| REPL_STATE
    
    style EXEC fill:#e6f3ff
    style REPL fill:#ffe6f0
    style PRIN fill:#f0ffe6
```

**Key Components**:
- **executeCalls**: Validates owner and principal, then executes array of contract calls
- **replaceOwner**: Enables migration by transferring to designated replacement owner
- **Principal Identity**: Immutable CAIP-10 identity (chain + account)
- **Replaceable Ownership**: Current owner can designate successor for migration

## C4 Level 4: Component Diagram - RemoteAccountFactory

```mermaid
graph TB
    subgraph "RemoteAccountFactory Components"
        PROV[provide<br/>Public Provision]
        PROVR[provideForRouter<br/>Internal Provision]
        PROVINT[_provideForRouter<br/>Core Logic]
        VAL[_isValidExistingAccount<br/>Validation]
    end
    
    subgraph "Inherited Behaviors"
        RA[RemoteAccount<br/>Is also a RemoteAccount]
    end
    
    subgraph "CREATE2 Logic"
        SALT["Salt Generation<br/>hash(caip2:account)"]
        CREATE[new RemoteAccount<br/>CREATE2 Deploy]
        TRANS[transferOwnership<br/>To Router]
    end
    
    PROV -->|validates router| PROVINT
    PROVR -->|self-call check| PROVINT
    PROVINT --> SALT
    PROVINT --> CREATE
    CREATE -->|on success| TRANS
    CREATE -->|on failure| VAL
    VAL -->|checks code| CHECK1[Code Exists?]
    VAL -->|checks principal| CHECK2[Principal Match?]
    VAL -->|checks owner| CHECK3[Owner Match?]
    
    style PROV fill:#e6ffe6
    style PROVINT fill:#ffe6e6
    style CREATE fill:#e6e6ff
    style VAL fill:#ffffe6
```

**Key Components**:
- **provide**: Public method requiring caller is current factory owner
- **provideForRouter**: Self-call method allowing arbitrary router specification
- **_provideForRouter**: Core CREATE2 logic with deterministic address generation
- **Validation**: Multi-layer verification of existing accounts (code, principal, owner)

## Data Flow: Cross-Chain Operation

```mermaid
sequenceDiagram
    participant PM as Portfolio Manager<br/>(Agoric)
    participant AXL as Axelar Gateway
    participant PR as PortfolioRouter
    participant P2 as Permit2
    participant RAF as RemoteAccountFactory
    participant RA as RemoteAccount
    participant DEFI as DeFi Protocol
    
    PM->>AXL: Send RouterInstruction[]
    AXL->>PR: _execute(sourceChain, sourceAddress, payload)
    
    PR->>PR: Validate source chain & address
    PR->>PR: Decode RouterInstruction[]
    
    loop For each instruction
        PR->>PR: processInstruction(instruction)
        
        opt If depositPermit exists
            PR->>P2: permitWitnessTransferFrom(...)
            P2->>RA: Transfer tokens
        end
        
        opt If provideAccount
            PR->>RAF: provide(principal, router, address)
            RAF->>RAF: CREATE2 or validate
            RAF-->>RA: Deploy (if new)
            RAF->>RA: transferOwnership(router)
        end
        
        opt If multiCalls exist
            PR->>RA: executeCalls(principal, calls[])
            RA->>RA: Validate owner & principal
            loop For each call
                RA->>DEFI: call(target, data)
                DEFI-->>RA: result
            end
        end
        
        PR->>PR: emit OperationResult(id, success, reason)
    end
```

**Flow Description**:
1. Portfolio Manager sends instructions via Axelar GMP
2. PortfolioRouter validates message source
3. For each instruction, atomically executes:
   - **Deposit**: Transfer tokens via Permit2
   - **Provide**: Ensure RemoteAccount exists
   - **Multicall**: Execute DeFi operations
4. Each instruction success/failure emitted independently

## Ownership and Security Model

```mermaid
graph TB
    subgraph "Ownership Hierarchy"
        PM[Portfolio Manager<br/>Agoric Chain]
        PR[PortfolioRouter<br/>Current Owner]
        PR2[New PortfolioRouter<br/>Replacement]
        RAF[RemoteAccountFactory<br/>Owned by Router]
        RA[RemoteAccount<br/>Owned by Router]
    end
    
    subgraph "Authorization Checks"
        AXL_CHECK[Axelar Source<br/>Chain + Address]
        PRIN_CHECK[Principal Identity<br/>CAIP-10]
        OWN_CHECK[Owner Address<br/>Router]
        REPL_CHECK[Replacement Owner<br/>Migration]
    end
    
    PM -.->|represents| PRIN_CHECK
    PM -->|messages via Axelar| AXL_CHECK
    AXL_CHECK -->|authorizes| PR
    PR -->|owns| RAF
    PR -->|owns| RA
    
    PR -->|can designate| PR2
    PR2 -.->|becomes| REPL_CHECK
    
    RA -->|validates| PRIN_CHECK
    RA -->|validates| OWN_CHECK
    RAF -->|validates| OWN_CHECK
    
    style PRIN_CHECK fill:#ffe6e6
    style AXL_CHECK fill:#e6ffe6
    style OWN_CHECK fill:#e6e6ff
    style REPL_CHECK fill:#ffffe6
```

**Security Layers**:
1. **Axelar Validation**: Only messages from specific chain and address accepted
2. **Principal Validation**: RemoteAccount verifies CAIP-10 identity of controller
3. **Ownership**: Router owns all RemoteAccounts and Factory
4. **Replaceability**: Migration path via designated replacement owner

## Migration Strategy

```mermaid
sequenceDiagram
    participant PM as Portfolio Manager
    participant OLD as Old PortfolioRouter
    participant NEW as New PortfolioRouter
    participant RAF as RemoteAccountFactory
    participant RA as RemoteAccount
    
    Note over PM,RA: Step 1: Deploy New Router
    PM->>NEW: Deploy new PortfolioRouter
    
    Note over PM,RA: Step 2: Designate Replacement
    PM->>OLD: replaceOwner(newRouter)
    OLD->>OLD: Set replacementOwner_ = NEW
    
    Note over PM,RA: Step 3: Transfer Factory
    PM->>OLD: Send multicall instruction
    OLD->>RAF: executeCalls([replaceOwner(NEW)])
    RAF->>RAF: Validate OLD.replacementOwner == NEW
    RAF->>RAF: transferOwnership(NEW)
    
    Note over PM,RA: Step 4: Transfer Each Account
    loop For each RemoteAccount
        PM->>OLD: Send multicall instruction
        OLD->>RA: executeCalls([replaceOwner(NEW)])
        RA->>RA: Validate OLD.replacementOwner == NEW
        RA->>RA: transferOwnership(NEW)
    end
    
    Note over PM,RA: Step 5: Update PM Configuration
    PM->>PM: Update to send to NEW router
```

**Migration Features**:
- Non-disruptive: Can migrate one account at a time
- Safe: Requires both old and new router agreement
- Flexible: RemoteAccount addresses remain constant
- Auditable: All transfers via on-chain multicalls

## Contract Relationships

```mermaid
classDiagram
    class AxelarExecutable {
        <<external>>
        +_execute()
    }
    
    class RemoteRepresentative {
        -_principalCaip2: string
        -_principalAccount: string
        -_principalCaip10Hash: bytes32
        +isPrincipal(caip2, account): bool
        +principal(): (string, string)
        #_checkPrincipal(caip2, account)
    }
    
    class OwnableByReplaceableOwner {
        +replaceableOwner(): IReplaceableOwner
        #_replaceOwner(newOwner)
    }
    
    class Ownable {
        <<external>>
        +owner(): address
        +transferOwnership(newOwner)
    }
    
    class PortfolioRouter {
        +factory: IRemoteAccountFactory
        +permit2: IPermit2
        -ownerAuthority: address
        -replacementOwner_: IReplaceableOwner
        +processInstruction(instruction)
        +replaceOwner(newOwner)
    }
    
    class RemoteAccountFactory {
        +provide(principal, router, address): bool
        +provideForRouter(principal, router, address): bool
        -_provideForRouter(...): bool
        -_isValidExistingAccount(...): bool
    }
    
    class RemoteAccount {
        +executeCalls(source, calls)
        +replaceOwner(newOwner)
    }
    
    AxelarExecutable <|-- PortfolioRouter
    RemoteRepresentative <|-- PortfolioRouter
    RemoteRepresentative <|-- RemoteAccount
    Ownable <|-- OwnableByReplaceableOwner
    OwnableByReplaceableOwner <|-- RemoteAccount
    RemoteAccount <|-- RemoteAccountFactory
    
    PortfolioRouter --> RemoteAccountFactory: uses
    PortfolioRouter --> RemoteAccount: controls
    RemoteAccountFactory ..> RemoteAccount: creates
```

## Key Design Patterns

### 1. **Principal-Agent Pattern**
- **Principal**: Portfolio Manager on Agoric (immutable identity via CAIP-10)
- **Agent**: RemoteAccount on EVM chain (executes on behalf of principal)
- **Authorization**: Dual validation via Axelar source + Principal identity

### 2. **Factory Pattern with CREATE2**
- Deterministic address generation based on principal identity
- Independent of router address for stability across migrations
- Idempotent operations (safe to call multiple times)

### 3. **Atomic Batch Processing**
- Each instruction processed atomically (deposit → provide → multicall)
- Individual instruction failures don't revert entire batch
- Fine-grained success/failure reporting via events

### 4. **Replaceable Ownership**
- Two-phase migration: designation + execution
- Both old and new router must agree
- Enables non-custodial upgrades

### 5. **Defense in Depth**
- Multiple validation layers: Axelar, Principal, Owner
- Redundant checks even when logically implied
- Self-call patterns to prevent unauthorized access

## Interface Contracts

### IPermit2
```solidity
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }
    
    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }
    
    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }
    
    function permitWitnessTransferFrom(...) external;
}
```

**Purpose**: Uniswap's Permit2 for gasless, signature-based token transfers with witness data.

### IRemoteRepresentative
```solidity
interface IRemoteRepresentative {
    function isPrincipal(caip2, account) external view returns (bool);
    function principal() external view returns (string, string);
}
```

**Purpose**: Contracts representing interests of a remote principal identified by CAIP-10.

### IReplaceableOwner
```solidity
interface IReplaceableOwner {
    function replacementOwner() external view returns (IReplaceableOwner);
}
```

**Purpose**: Enables migration by allowing current owner to designate successor.

## Data Structures

### RouterInstruction
```solidity
struct RouterInstruction {
    string id;                      // Unique identifier for tracing
    string portfolioLCA;            // Portfolio manager's account
    address remoteAccountAddress;   // Target RemoteAccount
    bool provideAccount;            // Whether to create/verify account
    DepositPermit[] depositPermit;  // Token transfer permits (0 or 1)
    ContractCall[] multiCalls;      // DeFi operations to execute
}
```

### ContractCall
```solidity
struct ContractCall {
    address target;  // Contract to call
    bytes data;      // Encoded function call
}
```

### DepositPermit
```solidity
struct DepositPermit {
    address tokenOwner;                    // Token owner address
    IPermit2.PermitTransferFrom permit;    // Permit details
    bytes32 witness;                       // Witness hash
    string witnessTypeString;              // Witness type
    bytes signature;                       // EIP-712 signature
}
```

## Deployment Sequence

```mermaid
sequenceDiagram
    participant DEP as Deployer
    participant P2 as Permit2
    participant AXL as Axelar Gateway
    participant RAF as RemoteAccountFactory
    participant PR as PortfolioRouter
    
    Note over DEP,PR: Prerequisites
    DEP->>P2: Deploy or use existing Permit2
    DEP->>AXL: Use existing Axelar Gateway
    
    Note over DEP,PR: Factory Deployment
    DEP->>RAF: new RemoteAccountFactory(principalCaip2, principalAccount)
    
    Note over DEP,PR: Router Deployment
    DEP->>PR: new PortfolioRouter(<br/>  axelarGateway,<br/>  sourceChain,<br/>  portfolioCaip2,<br/>  portfolioAccount,<br/>  factoryAddress,<br/>  permit2Address,<br/>  ownerAuthority<br/>)
    PR->>RAF: Verify isPrincipal(portfolioCaip2, portfolioAccount)
    
    Note over DEP,PR: Initial Setup
    DEP->>RAF: transferOwnership(routerAddress)
    
    Note over DEP,PR: System Ready
```

## Summary

This Portfolio Router system provides a robust, secure, and upgradeable architecture for cross-chain portfolio management:

- **Security**: Multi-layer validation (Axelar, Principal, Owner)
- **Flexibility**: Atomic operations with independent failure handling
- **Upgradeability**: Non-custodial migration path via replaceable ownership
- **Determinism**: CREATE2 ensures stable account addresses
- **Efficiency**: Gasless deposits via Permit2, batch operations

The design enables a Portfolio Manager on Agoric to maintain full control over EVM-based DeFi positions while supporting protocol evolution through safe migration mechanisms.
