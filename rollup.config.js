import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import strip from 'rollup-plugin-strip';
import commonjs from '@rollup/plugin-commonjs';
import {terser} from "rollup-plugin-terser"
import copy from 'rollup-plugin-copy';

export default [
    {
        input: 'js/index.js',
        output: [
            {file: 'dist/juicebox.esm.js', format: 'es'}
        ],
        plugins: [
            strip({
                debugger: true,
                functions: [/*'console.log',*/ 'assert.*', 'debug']
            }),
            copy({
                targets:
                    [
                        {src: 'css/juicebox.css', dest: 'dist/css/'},
                        {src: 'css/img', dest: 'dist/css/'}
                    ]
            })
        ]
    },

    {
        input: 'js/index.js',
        output: [
            {file: 'dist/juicebox.js', format: 'umd', name: "juicebox"},
            {file: 'dist/juicebox.min.js', format: 'umd', name: "juicebox", sourcemap: true, plugins: [terser()]},
        ],
        plugins: [
            strip({
                debugger: true,
                functions: [/*'console.log', */'assert.*', 'debug']
            }),
            commonjs(),
            nodeResolve(),
            babel()
        ]
    }
]

