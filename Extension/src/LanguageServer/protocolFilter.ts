/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { Middleware } from 'vscode-languageclient';
import { Client } from './client';
import * as vscode from 'vscode';
import { clients, onDidChangeActiveTextEditor } from './extension';
import { shouldChangeFromCToCpp } from './utils';

export function createProtocolFilter(): Middleware {
    // Disabling lint for invoke handlers
    const invoke1 = async (a: any, next: (a: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a); };
    const invoke2 = async (a: any, b: any, next: (a: any, b: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a, b); };
    const invoke3 = async (a: any, b: any, c: any, next: (a: any, b: any, c: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a, b, c); };
    const invoke4 = async (a: any, b: any, c: any, d: any, next: (a: any, b: any, c: any, d: any) => any) => { await clients.ActiveClient.awaitUntilLanguageClientReady(); return next(a, b, c, d); };    /* tslint:enable */

    return {
        didOpen: async (document, sendMessage) => {
            await clients.ActiveClient.awaitUntilLanguageClientReady();
            const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) {
                // If the file was visible editor when we were activated, we will not get a call to
                // onDidChangeVisibleTextEditors, so immediately open any file that is visible when we receive didOpen.
                // Otherwise, we defer opening the file until it's actually visible.
                const me: Client = clients.getClientFor(document.uri);
                if (!me.TrackedDocuments.has(document)) {
                    // Log warm start.
                    clients.timeTelemetryCollector.setDidOpenTime(document.uri);
                    if (clients.checkOwnership(me, document)) {
                        me.TrackedDocuments.add(document);
                        const finishDidOpen = async (doc: vscode.TextDocument) => {
                            await me.provideCustomConfiguration(doc.uri, undefined);
                            await sendMessage(doc);
                            me.onDidOpenTextDocument(doc);
                            if (editor && editor === vscode.window.activeTextEditor) {
                                onDidChangeActiveTextEditor(editor);
                            }
                        };
                        if (document.languageId === "c" && shouldChangeFromCToCpp(document)) {
                            const baesFileName: string = path.basename(document.fileName);
                            const mappingString: string = baesFileName + "@" + document.fileName;
                            me.addFileAssociations(mappingString, "cpp");
                            me.sendDidChangeSettings();
                            document = await vscode.languages.setTextDocumentLanguage(document, "cpp");
                        }
                        await finishDidOpen(document);
                    }
                }
            } else {
                // NO-OP
                // If the file is not opened into an editor (such as in response for a control-hover),
                // we do not actually load a translation unit for it.  When we receive a didOpen, the file
                // may not yet be visible.  So, we defer creation of the translation until we receive a
                // call to onDidChangeVisibleTextEditors(), in extension.ts.  A file is only loaded when
                // it is actually opened in the editor (not in response to control-hover, which sends a
                // didOpen), and first becomes visible.
            }
        },
        didChange: async (textDocumentChangeEvent, sendMessage) => {
            await clients.ActiveClient.awaitUntilLanguageClientReady();
            const me: Client = clients.getClientFor(textDocumentChangeEvent.document.uri);
            me.onDidChangeTextDocument(textDocumentChangeEvent);
            await sendMessage(textDocumentChangeEvent);
        },
        willSave: invoke1,
        willSaveWaitUntil: async (event, sendMessage) => {
            // await clients.ActiveClient.awaitUntilLanguageClientReady();
            // Don't use awaitUntilLanguageClientReady.
            // Otherwise, the message can be delayed too long.
            const me: Client = clients.getClientFor(event.document.uri);
            if (me.TrackedDocuments.has(event.document)) {
                return sendMessage(event);
            }
            return [];
        },
        didSave: invoke1,
        didClose: async (document, sendMessage) => {
            await clients.ActiveClient.awaitUntilLanguageClientReady();
            const me: Client = clients.getClientFor(document.uri);
            if (me.TrackedDocuments.has(document)) {
                me.onDidCloseTextDocument(document);
                me.TrackedDocuments.delete(document);
                await sendMessage(document);
            }
        },
        provideCompletionItem: invoke4,
        resolveCompletionItem: invoke2,
        provideHover: async (document, position, token, next: (document: any, position: any, token: any) => any) => {
            await clients.ActiveClient.awaitUntilLanguageClientReady();
            const me: Client = clients.getClientFor(document.uri);
            if (me.TrackedDocuments.has(document)) {
                return next(document, position, token);
            }
            return null;
        },
        provideSignatureHelp: invoke4,
        provideDefinition: invoke3,
        provideReferences: invoke4,
        provideDocumentHighlights: invoke3,
        provideDeclaration: invoke3,
        workspace: {
            didChangeConfiguration: invoke1
        }
    };
}
