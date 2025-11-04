import { distanceTo } from '../utils/mathUtils.js'

self.addEventListener('message', ({ data }) => {

    if ('trace' === data.traceOrEnsemble) {

        const str = `Distance Map Worker - Update Trace Distance Array`
        console.time(str)

        const vertices = JSON.parse(data.verticesString)
        const { maxDistance, distances } = updateTraceDistanceArray(data.traceLength, vertices)

        console.timeEnd(str)

        const payload =
            {
                traceOrEnsemble: data.traceOrEnsemble,
                workerDistanceBuffer: distances,
                maxDistance
            }

        self.postMessage(payload, [ distances.buffer ])

    } else {

        const str = `Distance Map Worker - Update Ensemble Distance Array`
        console.time(str);

        const vertexLists = JSON.parse(data.vertexListsString)
        const { maxAverageDistance, averages } = updateEnsembleDistanceArray(data.traceLength, vertexLists)

        console.timeEnd(str)

        const payload =
            {
                traceOrEnsemble: data.traceOrEnsemble,
                workerDistanceBuffer: averages,
                maxDistance: maxAverageDistance
            }

        self.postMessage(payload, [ averages.buffer ])

    }

}, false)

const kDistanceUndefined = -1;

function updateTraceDistanceArray(traceLength, vertices) {

    const distances = new Float32Array(traceLength * traceLength)
    distances.fill(kDistanceUndefined)

    const validVertices = []
    const validIndices = []

    for (let i = 0; i < vertices.length; i++) {
        if (true === vertices[ i ].isMissingData) {
            // ignore
        } else {
            validIndices.push(i)
            validVertices.push(vertices[ i ])
        }
    }

    let maxDistance = Number.NEGATIVE_INFINITY;

    let exclusionSet = new Set();

    for (let v = 0; v < validVertices.length; v++) {

        const x = validIndices[ v ]

        const xy_diagonal = x * traceLength + x

        distances[ xy_diagonal ] = 0

        exclusionSet.add(v)
        for (let w = 0; w < validVertices.length; w++) {


            if (false === exclusionSet.has(w)) {

                const distance = distanceTo(validVertices[ v ], validVertices[ w ])

                const y = validIndices[ w ]

                const ij =  x * traceLength + y
                const ji =  y * traceLength + x

                distances[ ij ] = distances[ ji ] = distance

                maxDistance = Math.max(maxDistance, distance)
            }

        }

    }

    return { maxDistance, distances }

}

function updateEnsembleDistanceArray(traceLength, vertexLists) {

    const averages  = new Float32Array(traceLength * traceLength)
    averages.fill(kDistanceUndefined)

    const counters = new Int32Array(traceLength * traceLength)
    counters.fill(0)

    for (let vertices of vertexLists) {

        const { maxDistance, distances } = updateTraceDistanceArray(traceLength, vertices)

        // We need to calculate an array of averages where the input data
        // can have missing - kDistanceUndefined - values

        // loop over distance array
        for (let d = 0; d < distances.length; d++) {

            // ignore missing data values. they do not participate in the average
            if (kDistanceUndefined === distances[ d ]) {
                // do nothing
            } else {

                // keep track of how many samples we have at this array index
                ++counters[ d ];

                if (kDistanceUndefined === averages[ d ]) {

                    // If this is the first data value at this array index copy it to average.
                    averages[ d ] = distances[ d ];
                } else {

                    // when there is data AND a pre-existing average value at this array index
                    // use an incremental averaging approach.

                    // Incremental averaging: avg_k = avg_k-1 + (distance_k - avg_k-1) / k
                    // https://math.stackexchange.com/questions/106700/incremental-averageing
                    averages[ d ] = averages[ d ] + (distances[ d ] - averages[ d ]) / counters[ d ];
                }

            }
        }

    }

    let maxAverageDistance = Number.NEGATIVE_INFINITY;
    for (let avg of averages) {
        maxAverageDistance = Math.max(maxAverageDistance, avg)
    }

    return { maxAverageDistance, averages }
}

