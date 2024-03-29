<?php

/*
 * This file is part of the Solarium package.
 *
 * For the full copyright and license information, please view the COPYING
 * file that was distributed with this source code.
 */

namespace Solarium\Core\Client\Adapter;

use Solarium\Core\Client\Endpoint;
use Solarium\Core\Client\Request;
use Solarium\Core\Client\Response;
use Solarium\Core\Configurable;
use Solarium\Exception\HttpException;
use Solarium\Exception\InvalidArgumentException;
use Solarium\Exception\RuntimeException;

/**
 * cURL HTTP adapter.
 *
 * @author Intervals <info@myintervals.com>
 */
class Curl extends Configurable implements AdapterInterface, TimeoutAwareInterface, ConnectionTimeoutAwareInterface, ProxyAwareInterface
{
    use TimeoutAwareTrait;
    use ConnectionTimeoutAwareTrait;
    use ProxyAwareTrait;

    /**
     * Execute a Solr request using the cURL library.
     *
     * @param Request  $request
     * @param Endpoint $endpoint
     *
     * @return Response
     */
    public function execute(Request $request, Endpoint $endpoint): Response
    {
        return $this->getData($request, $endpoint);
    }

    /**
     * Get the response for a cURL handle.
     *
     * @param \CurlHandle  $handle
     * @param string|false $httpResponse
     *
     * @throws HttpException
     *
     * @return Response
     */
    public function getResponse(\CurlHandle $handle, $httpResponse): Response
    {
        if (CURLE_OK !== curl_errno($handle)) {
            $errno = curl_errno($handle);
            $error = curl_error($handle);
            curl_close($handle);
            throw new HttpException(sprintf('HTTP request failed, %s', $error), $errno);
        }

        $httpCode = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $headers = [];
        $headers[] = 'HTTP/1.1 '.$httpCode.' OK';

        curl_close($handle);

        return new Response($httpResponse, $headers);
    }

    /**
     * Create cURL handle for a request.
     *
     * @param Request  $request
     * @param Endpoint $endpoint
     *
     * @throws InvalidArgumentException
     *
     * @return \CurlHandle
     */
    public function createHandle(Request $request, Endpoint $endpoint): \CurlHandle
    {
        $uri = AdapterHelper::buildUri($request, $endpoint);

        $method = $request->getMethod();
        $options = $this->createOptions($request, $endpoint);

        $handler = curl_init();
        curl_setopt($handler, CURLOPT_URL, $uri);
        curl_setopt($handler, CURLOPT_RETURNTRANSFER, $options['return_transfer']);
        if (!(\function_exists('ini_get') && ini_get('open_basedir'))) {
            curl_setopt($handler, CURLOPT_FOLLOWLOCATION, true);
        }
        curl_setopt($handler, CURLOPT_TIMEOUT, $options['timeout']);
        curl_setopt($handler, CURLOPT_CONNECTTIMEOUT, $options['connection_timeout']);

        if (null !== $options['proxy']) {
            curl_setopt($handler, CURLOPT_PROXY, $options['proxy']);
        }

        // Try endpoint authentication first, fallback to request for backwards compatibility
        $authData = $endpoint->getAuthentication();
        if (empty($authData['username'])) {
            $authData = $request->getAuthentication();
        }

        if (!empty($authData['username']) && !empty($authData['password'])) {
            curl_setopt($handler, CURLOPT_USERPWD, $authData['username'].':'.$authData['password']);
            curl_setopt($handler, CURLOPT_HTTPAUTH, CURLAUTH_BASIC);
        } elseif (!isset($options['headers']) || !\array_key_exists('Authorization', $options['headers'])) {
            // According to the specification, only one Authorization header is allowed.
            // @see https://stackoverflow.com/questions/29282578/multiple-http-authorization-headers
            $tokenData = $endpoint->getAuthorizationToken();
            if (!empty($tokenData['tokenname']) && !empty($tokenData['token'])) {
                $options['headers']['Authorization'] = $tokenData['tokenname'].' '.$tokenData['token'];
            }
        }

        if (0 !== \count($options['headers'] ?? [])) {
            $headers = [];
            foreach ($options['headers'] as $key => $value) {
                $headers[] = $key.': '.$value;
            }
            curl_setopt($handler, CURLOPT_HTTPHEADER, $headers);
        }

        if (Request::METHOD_POST === $method) {
            curl_setopt($handler, CURLOPT_POST, true);

            if ($request->getFileUpload()) {
                $data = AdapterHelper::buildUploadBodyFromRequest($request);
                curl_setopt($handler, CURLOPT_POSTFIELDS, $data);
            } else {
                curl_setopt($handler, CURLOPT_POSTFIELDS, $request->getRawData());
            }
        } elseif (Request::METHOD_GET === $method) {
            curl_setopt($handler, CURLOPT_HTTPGET, true);
        } elseif (Request::METHOD_HEAD === $method) {
            curl_setopt($handler, CURLOPT_NOBODY, true);
        } elseif (Request::METHOD_DELETE === $method) {
            curl_setopt($handler, CURLOPT_CUSTOMREQUEST, 'DELETE');
        } elseif (Request::METHOD_PUT === $method) {
            curl_setopt($handler, CURLOPT_CUSTOMREQUEST, 'PUT');

            if ($request->getFileUpload()) {
                $data = AdapterHelper::buildUploadBodyFromRequest($request);
                curl_setopt($handler, CURLOPT_POSTFIELDS, $data);
            } else {
                curl_setopt($handler, CURLOPT_POSTFIELDS, $request->getRawData());
            }
        } else {
            throw new InvalidArgumentException(sprintf('unsupported method: %s', $method));
        }

        return $handler;
    }

    public function setOption(string $name, $value): Configurable
    {
        if ('proxy' === $name) {
            $this->setProxy($value);
            trigger_error('Setting proxy as an option is deprecated. Use setProxy() instead.', \E_USER_DEPRECATED);
        }

        return parent::setOption($name, $value);
    }

    /**
     * Execute request.
     *
     * @param Request  $request
     * @param Endpoint $endpoint
     *
     * @return Response
     */
    protected function getData(Request $request, Endpoint $endpoint): Response
    {
        $handle = $this->createHandle($request, $endpoint);
        $httpResponse = curl_exec($handle);

        return $this->getResponse($handle, $httpResponse);
    }

    /**
     * Initialization hook.
     *
     * {@internal Check if PHP was compiled with cURL support.
     *            Check for deprecated use of 'proxy' option.}
     *
     * @throws RuntimeException
     */
    protected function init()
    {
        if (!\function_exists('curl_init')) {
            // @codeCoverageIgnoreStart
            throw new RuntimeException('cURL is not available, install it to use the CurlHttp adapter');
            // @codeCoverageIgnoreEnd
        }

        if (isset($this->options['proxy'])) {
            $this->setProxy($this->options['proxy']);
            trigger_error('Setting proxy as an option is deprecated. Use setProxy() instead.', \E_USER_DEPRECATED);
        }
    }

    /**
     * Create http request options from request.
     *
     * @param Request  $request
     * @param Endpoint $endpoint
     *
     * @return array
     */
    protected function createOptions(Request $request, Endpoint $endpoint): array
    {
        $options = $this->options + [
            'timeout' => $this->timeout,
            'connection_timeout' => $this->connectionTimeout ?? $this->timeout,
            'proxy' => $this->proxy,
            'return_transfer' => true,
        ];
        foreach ($request->getHeaders() as $headerLine) {
            list($header, $value) = explode(':', $headerLine);
            if ('' !== $header = trim($header)) {
                $options['headers'][$header] = trim($value);
            }
        }

        return $options;
    }
}
