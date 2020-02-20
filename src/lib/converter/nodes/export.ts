import * as ts from 'typescript';

import { Reflection, ReflectionFlag, DeclarationReflection, ContainerReflection } from '../../models/index';
import { Context } from '../context';
import { Component, ConverterNodeComponent } from '../components';
import { createReferenceReflection } from '../factories/reference';
import { SourceFileMode } from '../../utils';

@Component({name: 'node:export'})
export class ExportConverter extends ConverterNodeComponent<ts.ExportAssignment> {
    /**
     * List of supported TypeScript syntax kinds.
     */
    supports: ts.SyntaxKind[] = [
        ts.SyntaxKind.ExportAssignment
    ];

    convert(context: Context, node: ts.ExportAssignment): Reflection {
        let symbol: ts.Symbol | undefined;

        // default export
        if (node.symbol && (node.symbol.flags & ts.SymbolFlags.Alias) === ts.SymbolFlags.Alias) {
            symbol = context.checker.getAliasedSymbol(node.symbol);
        } else {
            let type = context.getTypeAtLocation(node.expression);
            symbol = type ? type.symbol : undefined;
        }
        if (symbol && symbol.declarations) {
            const project = context.project;
            symbol.declarations.forEach((declaration) => {
                if (!declaration.symbol) {
                    return;
                }

                const reflection = project.getReflectionFromFQN(context.checker.getFullyQualifiedName(declaration.symbol));
                if (node.isExportEquals && reflection instanceof DeclarationReflection) {
                    reflection.setFlag(ReflectionFlag.ExportAssignment, true);
                }
                if (reflection) {
                    markAsExported(reflection);
                }
            });
        }

        function markAsExported(reflection: Reflection) {
            if (reflection instanceof DeclarationReflection) {
                reflection.setFlag(ReflectionFlag.Exported, true);
            }

            reflection.traverse(markAsExported);
        }

        return context.scope;
    }
}

@Component({ name: 'node:export-declaration' })
export class ExportDeclarationConverter extends ConverterNodeComponent<ts.ExportDeclaration> {
    supports = [ts.SyntaxKind.ExportDeclaration];

    convert(context: Context, node: ts.ExportDeclaration): Reflection | undefined {
        // It doesn't make sense to convert export declarations if we are pretending everything is global.
        if (this.application.options.getValue('mode') === SourceFileMode.File) {
            return;
        }

        const scope = context.scope;
        if (!(scope instanceof ContainerReflection)) {
            throw new Error('Expected to be within a container');
        }

        if (node.exportClause) { // export { a, a as b }
            node.exportClause.elements.forEach(specifier => {
                const source = context.getSymbolAtLocation(specifier.name);
                const target = context.resolveAliasedSymbol(context.getSymbolAtLocation(specifier.propertyName ?? specifier.name));
                if (source && target) {
                    // If the original declaration is in this file, export {} was used with something
                    // defined in this file and we don't need to create a reference unless the name is different.
                    if (!node.moduleSpecifier && !specifier.propertyName) {
                        return;
                    }

                    createReferenceReflection(context, source, target);
                }
            });
        } else if (node.moduleSpecifier) { // export * from ...
            const sourceFileSymbol = context.getSymbolAtLocation(node.moduleSpecifier);
            for (const symbol of context.checker.getExportsOfModule(sourceFileSymbol!)) {
                if (symbol.name === 'default') { // Default exports are not re-exported with export *
                    continue;
                }
                createReferenceReflection(context, symbol, context.resolveAliasedSymbol(symbol));
            }
        }

        return context.scope;
    }
}
