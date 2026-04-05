/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/confidential_desk.json`.
 */
export type ConfidentialDesk = {
  "address": "HVN74rb5SBJoi6iNiPYKuKpiDB5xs5BBXCqKuzoFuZDb",
  "metadata": {
    "name": "confidentialDesk",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Confidential Lending Desk — private positions on PER, settlement on base"
  },
  "instructions": [
    {
      "name": "bootstrapDeskBorrowMintEspl",
      "docs": [
        "Base-only: ESPL bootstrap for the borrow mint / pool vault (desk PDA is off-curve; JS `delegateSpl` cannot do this)."
      ],
      "discriminator": [
        15,
        27,
        182,
        73,
        124,
        37,
        106,
        189
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "borrowMint"
        },
        {
          "name": "borrowVault",
          "writable": true
        },
        {
          "name": "eata",
          "writable": true
        },
        {
          "name": "globalVault",
          "writable": true
        },
        {
          "name": "vaultEphemeralAta",
          "writable": true
        },
        {
          "name": "globalVaultAta",
          "writable": true
        },
        {
          "name": "delegationBuffer",
          "writable": true
        },
        {
          "name": "delegationRecord",
          "writable": true
        },
        {
          "name": "delegationMetadata",
          "writable": true
        },
        {
          "name": "esplTokenProgram"
        },
        {
          "name": "delegationProgram"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "validator",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "bootstrapDeskLpMintEspl",
      "docs": [
        "Base-only: ESPL bootstrap for the LP mint (enables `MintTo` on PER for that mint)."
      ],
      "discriminator": [
        1,
        1,
        123,
        101,
        145,
        5,
        57,
        133
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "lpMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "deskLpAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "lpMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "eata",
          "writable": true
        },
        {
          "name": "globalVault",
          "writable": true
        },
        {
          "name": "vaultEphemeralAta",
          "writable": true
        },
        {
          "name": "globalVaultAta",
          "writable": true
        },
        {
          "name": "delegationBuffer",
          "writable": true
        },
        {
          "name": "delegationRecord",
          "writable": true
        },
        {
          "name": "delegationMetadata",
          "writable": true
        },
        {
          "name": "esplTokenProgram"
        },
        {
          "name": "delegationProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "validator",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "borrow",
      "discriminator": [
        228,
        253,
        131,
        202,
        207,
        116,
        89,
        18
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "deskLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              }
            ]
          }
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "borrowVault",
          "writable": true
        },
        {
          "name": "userBorrowAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeBorrowerPositionPer",
      "discriminator": [
        117,
        72,
        40,
        113,
        15,
        132,
        229,
        120
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closeLenderPositionPer",
      "discriminator": [
        238,
        84,
        142,
        0,
        94,
        37,
        55,
        115
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "lenderPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "delegateBorrower",
      "discriminator": [
        94,
        193,
        204,
        123,
        228,
        7,
        214,
        82
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                244,
                255,
                29,
                212,
                6,
                128,
                47,
                32,
                170,
                159,
                54,
                110,
                40,
                191,
                206,
                115,
                50,
                49,
                1,
                241,
                191,
                147,
                141,
                136,
                108,
                72,
                94,
                183,
                133,
                215,
                133,
                90
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "validator",
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "HVN74rb5SBJoi6iNiPYKuKpiDB5xs5BBXCqKuzoFuZDb"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "delegateDeskLedger",
      "discriminator": [
        149,
        53,
        86,
        185,
        42,
        56,
        57,
        75
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                244,
                255,
                29,
                212,
                6,
                128,
                47,
                32,
                170,
                159,
                54,
                110,
                40,
                191,
                206,
                115,
                50,
                49,
                1,
                241,
                191,
                147,
                141,
                136,
                108,
                72,
                94,
                183,
                133,
                215,
                133,
                90
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              }
            ]
          }
        },
        {
          "name": "validator",
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "HVN74rb5SBJoi6iNiPYKuKpiDB5xs5BBXCqKuzoFuZDb"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "delegateLender",
      "discriminator": [
        3,
        208,
        75,
        142,
        103,
        161,
        225,
        11
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                244,
                255,
                29,
                212,
                6,
                128,
                47,
                32,
                170,
                159,
                54,
                110,
                40,
                191,
                206,
                115,
                50,
                49,
                1,
                241,
                191,
                147,
                141,
                136,
                108,
                72,
                94,
                183,
                133,
                215,
                133,
                90
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "validator",
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "HVN74rb5SBJoi6iNiPYKuKpiDB5xs5BBXCqKuzoFuZDb"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "depositCollateral",
      "discriminator": [
        156,
        131,
        142,
        116,
        146,
        247,
        162,
        120
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "userCollateralAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositLiquidity",
      "discriminator": [
        245,
        99,
        59,
        25,
        151,
        71,
        233,
        249
      ],
      "accounts": [
        {
          "name": "lender",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "docs": [
            "Read-only on PER: desk config is mirrored from base; only delegated PDAs + token accounts are writable."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "deskLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              }
            ]
          }
        },
        {
          "name": "lenderPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "lender"
              }
            ]
          }
        },
        {
          "name": "borrowVault",
          "writable": true
        },
        {
          "name": "lpMint",
          "writable": true
        },
        {
          "name": "lenderBorrowAta",
          "writable": true
        },
        {
          "name": "lenderLpAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "lpToMint",
          "type": "u64"
        }
      ]
    },
    {
      "name": "healthTickBorrower",
      "discriminator": [
        97,
        125,
        1,
        115,
        135,
        65,
        233,
        165
      ],
      "accounts": [
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "borrower_position.owner",
                "account": "borrowerPosition"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initDeskVaults",
      "discriminator": [
        235,
        169,
        192,
        251,
        251,
        216,
        243,
        170
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "borrowMint"
        },
        {
          "name": "collateralVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "collateralMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "borrowVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "borrowMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeDesk",
      "discriminator": [
        154,
        108,
        165,
        208,
        97,
        238,
        48,
        246
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "collateralMint"
              },
              {
                "kind": "account",
                "path": "borrowMint"
              }
            ]
          }
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "borrowMint"
        },
        {
          "name": "lpMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "collateralMint"
              },
              {
                "kind": "account",
                "path": "borrowMint"
              }
            ]
          }
        },
        {
          "name": "deskLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              }
            ]
          }
        },
        {
          "name": "permissionDeskLedger",
          "writable": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "interestRateBps",
          "type": "u16"
        },
        {
          "name": "ltvMaxBps",
          "type": "u16"
        },
        {
          "name": "liquidationThresholdBps",
          "type": "u16"
        },
        {
          "name": "liquidationBonusBps",
          "type": "u16"
        },
        {
          "name": "collateralPriceQ12",
          "type": "u64"
        }
      ]
    },
    {
      "name": "liquidatePer",
      "discriminator": [
        75,
        114,
        176,
        61,
        48,
        205,
        87,
        67
      ],
      "accounts": [
        {
          "name": "liquidator",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "deskLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              }
            ]
          }
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "borrower_position.owner",
                "account": "borrowerPosition"
              }
            ]
          }
        },
        {
          "name": "borrowVault",
          "writable": true
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "liquidatorBorrowAta",
          "writable": true
        },
        {
          "name": "liquidatorCollateralAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "openBorrower",
      "discriminator": [
        253,
        196,
        79,
        192,
        183,
        45,
        148,
        183
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "permissionBorrower",
          "writable": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openLender",
      "discriminator": [
        74,
        252,
        74,
        224,
        76,
        247,
        234,
        242
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "lenderPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "permissionLender",
          "writable": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer"
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "repay",
      "discriminator": [
        234,
        103,
        67,
        82,
        208,
        234,
        219,
        166
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "deskLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              }
            ]
          }
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "borrowVault",
          "writable": true
        },
        {
          "name": "userBorrowAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "scheduleHealthCrankDesk",
      "discriminator": [
        231,
        120,
        234,
        123,
        124,
        147,
        103,
        204
      ],
      "accounts": [
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "positionOwner",
          "signer": true
        },
        {
          "name": "borrowerPosition",
          "writable": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "HVN74rb5SBJoi6iNiPYKuKpiDB5xs5BBXCqKuzoFuZDb"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "scheduleHealthCrankDeskArgs"
            }
          }
        }
      ]
    },
    {
      "name": "updateOracle",
      "discriminator": [
        112,
        41,
        209,
        18,
        248,
        226,
        252,
        188
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "desk",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "collateralPriceQ12",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawCollateral",
      "discriminator": [
        115,
        135,
        168,
        106,
        139,
        214,
        138,
        150
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "borrowerPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  114,
                  114,
                  111,
                  119,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "collateralVault",
          "writable": true
        },
        {
          "name": "userCollateralAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawLp",
      "discriminator": [
        225,
        221,
        45,
        211,
        49,
        60,
        51,
        163
      ],
      "accounts": [
        {
          "name": "lender",
          "writable": true,
          "signer": true
        },
        {
          "name": "desk",
          "docs": [
            "Read-only on PER: desk config mirror (same as `DepositLiquidity`)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  115,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "desk.collateral_mint",
                "account": "deskConfig"
              },
              {
                "kind": "account",
                "path": "desk.borrow_mint",
                "account": "deskConfig"
              }
            ]
          }
        },
        {
          "name": "deskLedger",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  100,
                  103,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              }
            ]
          }
        },
        {
          "name": "lenderPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "desk"
              },
              {
                "kind": "account",
                "path": "lender"
              }
            ]
          }
        },
        {
          "name": "borrowVault",
          "writable": true
        },
        {
          "name": "lpMint",
          "writable": true
        },
        {
          "name": "lenderBorrowAta",
          "writable": true
        },
        {
          "name": "lenderLpAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "borrowerPosition",
      "discriminator": [
        22,
        15,
        23,
        98,
        200,
        151,
        249,
        66
      ]
    },
    {
      "name": "deskConfig",
      "discriminator": [
        50,
        232,
        76,
        9,
        116,
        204,
        140,
        153
      ]
    },
    {
      "name": "deskLedger",
      "discriminator": [
        35,
        179,
        146,
        124,
        54,
        23,
        162,
        246
      ]
    },
    {
      "name": "lenderPosition",
      "discriminator": [
        165,
        98,
        244,
        204,
        209,
        158,
        88,
        19
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6001,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6002,
      "name": "exceedsMaxLtv",
      "msg": "Exceeds max LTV"
    },
    {
      "code": 6003,
      "name": "notLiquidatable",
      "msg": "Position is not liquidatable"
    },
    {
      "code": 6004,
      "name": "openDebt",
      "msg": "Position has open debt"
    },
    {
      "code": 6005,
      "name": "openCollateral",
      "msg": "Position has open collateral"
    },
    {
      "code": 6006,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity"
    },
    {
      "code": 6007,
      "name": "invalidTimestamp",
      "msg": "Invalid timestamp"
    },
    {
      "code": 6008,
      "name": "unauthorized",
      "msg": "unauthorized"
    }
  ],
  "types": [
    {
      "name": "borrowerPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "desk",
            "type": "pubkey"
          },
          {
            "name": "collateralAmount",
            "type": "u64"
          },
          {
            "name": "debtAmount",
            "type": "u64"
          },
          {
            "name": "lastAccrualTs",
            "type": "i64"
          },
          {
            "name": "isLiquidatable",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "deskConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "borrowMint",
            "type": "pubkey"
          },
          {
            "name": "collateralVault",
            "type": "pubkey"
          },
          {
            "name": "borrowVault",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "interestRateBps",
            "type": "u16"
          },
          {
            "name": "ltvMaxBps",
            "type": "u16"
          },
          {
            "name": "liquidationThresholdBps",
            "type": "u16"
          },
          {
            "name": "liquidationBonusBps",
            "type": "u16"
          },
          {
            "name": "collateralPriceQ12",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          }
        ]
      }
    },
    {
      "name": "deskLedger",
      "docs": [
        "Pool accounting on PER (delegated)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "desk",
            "type": "pubkey"
          },
          {
            "name": "totalDeposits",
            "type": "u64"
          },
          {
            "name": "totalBorrowed",
            "type": "u64"
          },
          {
            "name": "lpTotalMinted",
            "docs": [
              "Mirrors LP supply on PER for share math."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lenderPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "desk",
            "type": "pubkey"
          },
          {
            "name": "depositAmount",
            "docs": [
              "USDC atoms notionally supplied (mirrors vault share accounting on PER)."
            ],
            "type": "u64"
          },
          {
            "name": "lpShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "scheduleHealthCrankDeskArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "taskId",
            "type": "i64"
          },
          {
            "name": "executionIntervalMillis",
            "type": "i64"
          },
          {
            "name": "iterations",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
