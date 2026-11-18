# IMD AWS reference

The [IMD API reference](https://api.imd.gov.in/public/api_reference.html) documents AWS/ARG observations and a station mapping endpoint. SkyGuard can display one authorized station as a read-only weather reference on the Station feed page. It does not write these observations to telemetry storage, score them, create incidents, or send notifications. IMD's documented AWS example contains mean sea-level pressure; it must not be treated as station-level pressure. The example does not specify the AWS observation time zone, so SkyGuard displays the date and time as supplied and does not infer freshness from them.

1. Register at the [IMD access portal](https://api.imd.gov.in/public/) and obtain access to the AWS/ARG endpoint. Contact IMD if you need the station call sign, authentication header and full header value, permitted use, or the AWS time zone.
2. In the ignored server-only `.env.skyguard.local`, set the following values supplied by IMD. Do not paste credentials into chat, client-side environment variables, or a committed file.

   ```env
   IMD_REFERENCE_STATION=<IMD station call sign>
   IMD_REFERENCE_AUTH_HEADER=<IMD-provided header name>
   IMD_REFERENCE_AUTH_VALUE=<IMD-provided full header value>
   ```

   Supported authentication header names are `Authorization` or an `X-` prefixed header. The public reference does not specify the credential header or value format, so confirm them with IMD rather than assuming a bearer token. The backend requests only `https://api.imd.gov.in/api/v1/aws_data` with the configured call sign and rejects redirects. If IMD requires a different authorization mechanism, the adapter must be updated after that mechanism is confirmed.
3. Restart the backend and open Station feed. The panel reports setup required or unavailable until access succeeds. Readings are cached for ten minutes. The parser follows the example in the public documentation; the actual response and access remain unverified until tested with approved credentials.

The older `IMD_AWS_API_URL` and `IMD_API_TOKEN` settings no longer activate an automatic IMD detector source. A future detection integration requires verified station mapping, time zone, pressure reference, quality flags and source-specific evaluation.
